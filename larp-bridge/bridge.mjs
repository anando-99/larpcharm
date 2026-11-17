#!/usr/bin/env node
// larp-bridge: links Claude Code on this computer to the Larp Charm (and, with an API key, your Steam profile).
//
//   Claude Code ──hooks / statusline──▶ bridge (127.0.0.1:7337) ──SSE──▶ web app ──BLE──▶ charm
//                                           ▲                                            │
//                                           └──────── permission answers, launches ◀─────┘
//
// No dependencies: node:http and friends only. Run it with `node larp-bridge/bridge.mjs`,
// then open http://localhost:7337 (the web app is served from here too) and press Connect.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, '..');
const PORT = +(process.env.LARP_PORT || 7337);
const ORIGINS = new Set((process.env.LARP_ORIGINS || `https://anando-99.github.io,http://localhost:${PORT},http://127.0.0.1:${PORT}`).split(','));
const PERM_WAIT_MS = 45000;          // after this the normal prompt in the terminal takes over
const LOG_MAX = 40;

// ── state ──
const presets = loadPresets();
const st = {
  state: 'offline',                  // offline, ready, thinking, tool, perm, waiting, done
  since: Date.now(),
  session: { id: '', name: '', cwd: '', project: '', model: '', version: '' },
  tool: '',                          // e.g. "Bash(npm test)"
  prompt: '',
  status: { ctx: 0, cost: 0, durationMs: 0, linesAdded: 0, linesRemoved: 0 },
  log: [],                           // { seq, k: user|text|tool|res|err, t }
  seq: 0,
  perm: null,                        // { id, tool, detail, project }
  presets: presets.map(p => p.name),
  clients: 0,                       // web apps watching
  remotes: 0,                        // ...of which have a charm connected, so permission prompts can wait for it
};
const waiting = new Map();           // permission id -> resolve(decision)
let permSeq = 1;

function loadPresets() {
  try { return JSON.parse(fs.readFileSync(path.join(HERE, 'presets.json'), 'utf8')).slice(0, 6); }
  catch { return [{ name: 'claude here', cwd: '~', prompt: '' }]; }
}
const home = p => (p || '').replace(/^~(?=$|\/)/, os.homedir());
const tidy = (s, n = 60) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7e]/g, '?').trim().slice(0, n);
const short = p => tidy((p || '').replace(os.homedir(), '~'), 60);

function log(k, t) {
  st.log.push({ seq: ++st.seq, k, t: tidy(t, 60) });
  if (st.log.length > LOG_MAX) st.log.shift();
}
function setState(s, tool) {
  if (st.state !== s) st.since = Date.now();
  st.state = s;
  if (tool !== undefined) st.tool = tool;
}

// how Claude Code itself shows a tool call: Bash(npm test), Read(app.js) ...
function toolLabel(name, input = {}) {
  const base = f => path.basename(String(f || ''));
  const arg = name === 'Bash' ? input.command
    : ['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(name) ? base(input.file_path || input.notebook_path)
    : name === 'Grep' || name === 'Glob' ? input.pattern
    : name === 'WebFetch' ? (() => { try { return new URL(input.url).host; } catch { return input.url; } })()
    : name === 'WebSearch' ? input.query
    : name === 'Task' || name === 'Agent' ? input.description
    : Object.values(input).find(v => typeof v === 'string');
  return tidy(arg ? `${name}(${tidy(arg, 48)})` : name, 60);
}
function resultLine(name, res) {
  if (!res || typeof res !== 'object') return 'done';
  if (typeof res.stdout === 'string') { const l = res.stdout.split('\n').map(s => s.trim()).filter(Boolean); return l.length ? tidy(l[l.length - 1], 56) : res.interrupted ? 'interrupted' : '(no output)'; }
  if (res.file && res.file.numLines) return `Read ${res.file.numLines} lines`;
  if (name === 'Write' || name === 'Edit' || name === 'MultiEdit') return `Updated ${path.basename(res.filePath || res.file_path || '') || 'file'}`;
  if (Array.isArray(res.filenames)) return `Found ${res.filenames.length} files`;
  if (typeof res.numFiles === 'number') return `Found ${res.numFiles} files`;
  return 'done';
}

// ── hook events from Claude Code ──
async function onHook(h) {
  const ev = h.hook_event_name;
  if (h.session_id && h.session_id !== st.session.id && ev !== 'SessionEnd') {
    st.session.id = h.session_id;
    if (ev !== 'SessionStart') { st.log = []; log('text', 'session attached'); }
  }
  if (h.cwd) { st.session.cwd = short(h.cwd); st.session.project = path.basename(h.cwd); }
  switch (ev) {
    case 'SessionStart':
      st.log = []; st.status = { ctx: 0, cost: 0, durationMs: 0, linesAdded: 0, linesRemoved: 0 };
      if (h.model) st.session.model = tidy(h.model, 30);
      log('text', h.source === 'resume' ? 'session resumed' : 'session started');
      setState('ready', '');
      break;
    case 'UserPromptSubmit':
      st.prompt = tidy(h.prompt, 60);
      log('user', h.prompt);
      setState('thinking', '');
      break;
    case 'PreToolUse': {
      const label = toolLabel(h.tool_name, h.tool_input);
      log('tool', label);
      setState('tool', label);
      break;
    }
    case 'PostToolUse':
      log('res', resultLine(h.tool_name, h.tool_response));
      if (st.perm) endPerm(st.perm.id, 'elsewhere');
      setState('thinking', '');
      break;
    case 'PostToolUseFailure':
      log('err', h.is_interrupt ? 'Interrupted' : String(h.error || 'failed').split('\n')[0]);
      if (st.perm) endPerm(st.perm.id, 'elsewhere');
      setState('thinking', '');
      break;
    case 'Notification':
      if (h.notification_type === 'idle_prompt' || /waiting for your input/i.test(h.message || '')) setState('waiting');
      else if (h.notification_type === 'permission_prompt' && !st.perm) setState('perm');
      break;
    case 'Stop': {
      const said = String(h.last_assistant_message || '').split(/(?<=[.!?])\s/)[0];
      if (said) log('text', said);
      if (st.perm) endPerm(st.perm.id, 'elsewhere');
      setState('done', '');
      break;
    }
    case 'SessionEnd':
      log('text', `session ended (${tidy(h.reason || 'exit', 20)})`);
      setState('offline', '');
      break;
    case 'PermissionRequest':
      return askCharm(h);
  }
  publish();
  return {};
}

// A permission prompt: ask the charm, wait for an answer, or step aside after a while.
function askCharm(h) {
  if (!st.remotes) return {};                      // no charm linked: let the terminal ask as usual
  const id = permSeq++ & 0xffff;
  const tool = tidy(h.tool_name, 24);
  const input = h.tool_input || {};
  const detail = tidy(input.command || input.file_path || input.url || input.pattern || input.description || JSON.stringify(input), 120);
  st.perm = { id, tool, detail, project: st.session.project };
  setState('perm', toolLabel(h.tool_name, input));
  publish();
  return new Promise(resolve => {
    const timer = setTimeout(() => { waiting.delete(id); endPerm(id, 'timeout'); resolve({}); }, PERM_WAIT_MS);
    waiting.set(id, decision => { clearTimeout(timer); resolve(decision); });
  });
}
function endPerm(id, how) {
  if (st.perm && st.perm.id === id) st.perm = null;
  if (how !== 'answered') { const w = waiting.get(id); if (w) { waiting.delete(id); w({}); } }
  publish({ type: 'permEnd', id, how });
}
function answerPerm(id, allow) {
  const w = waiting.get(id);
  if (!w) return false;
  waiting.delete(id);
  w({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: allow ? { behavior: 'allow' } : { behavior: 'deny', message: 'Denied from the Larp Charm' } } });
  log('text', allow ? 'allowed from the charm' : 'denied from the charm');
  endPerm(id, 'answered');
  setState(allow ? 'tool' : 'thinking');
  publish();
  return true;
}

// ── statusline data: model, cost, context ──
function onStatus(s) {
  if (s.model) st.session.model = tidy(s.model.display_name || s.model.id, 30);
  if (s.version) st.session.version = tidy(s.version, 16);
  if (s.session_name) st.session.name = tidy(s.session_name, 24);
  const ws = s.workspace || {};
  if (ws.current_dir || s.cwd) { const d = ws.current_dir || s.cwd; st.session.cwd = short(d); st.session.project = path.basename(d); }
  const c = s.cost || {}, cw = s.context_window || {};
  st.status = {
    ctx: Math.round(cw.used_percentage ?? st.status.ctx ?? 0),
    cost: c.total_cost_usd ?? st.status.cost,
    durationMs: c.total_duration_ms ?? st.status.durationMs,
    linesAdded: c.total_lines_added ?? st.status.linesAdded,
    linesRemoved: c.total_lines_removed ?? st.status.linesRemoved,
  };
  if (st.state === 'offline') setState('ready');
  publish();
}

// ── launcher: only the presets in presets.json can be started ──
function launch(i) {
  const p = presets[i];
  if (!p) return false;
  const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const parts = [`cd ${q(home(p.cwd || '~'))}`, ['claude', ...(p.args || []).map(q), ...(p.prompt ? [q(p.prompt)] : [])].join(' ')];
  const cmd = parts.join(' && ');
  log('text', `launching "${p.name}"`);
  publish();
  if (process.platform === 'darwin') {
    const as = cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    execFile('osascript', ['-e', `tell application "Terminal" to do script "${as}"`, '-e', 'tell application "Terminal" to activate'], err => { if (err) console.error('launch failed:', err.message); });
  } else {
    execFile('x-terminal-emulator', ['-e', 'sh', '-c', cmd], err => { if (err) console.error('launch failed (no terminal emulator found):', err.message); });
  }
  return true;
}

// ── Steam: your profile, library, hours and the game you're playing (Steam Web API) ──
// Steam's Web API sends no CORS headers, so the web page can't ask it. The bridge asks, with your API key, and streams
// the answer to the page like Claude Code's state. The key stays on this computer: STEAM_API_KEY / STEAM_ID in the
// environment, or larp-bridge/steam.json ({ "key": "...", "id": "profile URL, vanity name or SteamID64" }, git ignores it).
const STEAM_API = (process.env.STEAM_API_BASE || 'https://api.steampowered.com').replace(/\/$/, '');
const STEAM_NOW_MS = 30000, STEAM_LIB_MS = 10 * 60000;
// The key file lives in your home folder (~/.larp-bridge/steam.json, a folder only you can open), outside the repository,
// so no copy, zip or `git add` of the project can carry it. An older larp-bridge/steam.json is read once, then moved.
const STEAM_FILE = process.env.LARP_STEAM_FILE || path.join(os.homedir(), '.larp-bridge', 'steam.json');
const STEAM_OLD_FILE = path.join(HERE, 'steam.json');
const steamCfg = (() => {
  let f = {};
  for (const file of [STEAM_FILE, STEAM_OLD_FILE]) { try { f = JSON.parse(fs.readFileSync(file, 'utf8')); break; } catch {} }
  return { key: String(process.env.STEAM_API_KEY || f.key || '').trim(), id: String(process.env.STEAM_ID || f.id || '').trim() };
})();
const steam = { type: 'steam', configured: !!(steamCfg.key && steamCfg.id), ok: false, err: '', at: 0, profile: null, level: 0,
  playing: null, games: [], gameCount: 0, totalMin: 0, wkMin: 0, libPrivate: false, keySet: !!steamCfg.key, idText: steamCfg.id };
const steamPriv = { id: '', libAt: 0, busy: false, first: true, avaUrl: '', ava: null, avaFor: '' };

const steamScrub = s => steamCfg.key ? String(s).split(steamCfg.key).join('[key]') : String(s);
async function steamGet(iface, method, ver, params) {
  const q = new URLSearchParams({ key: steamCfg.key, format: 'json', ...params });
  const r = await fetch(`${STEAM_API}/${iface}/${method}/v${ver}/?${q}`, { signal: AbortSignal.timeout(10000) });
  if (r.status === 401 || r.status === 403) throw new Error('Steam rejected the API key');
  if (r.status === 429) throw new Error('Steam says: too many requests, slowing down');
  if (!r.ok) throw new Error(`Steam answered ${r.status}`);
  return (await r.json()).response || {};
}
// a profile URL, a vanity name or a SteamID64, to a SteamID64
async function steamResolve() {
  if (steamPriv.id) return steamPriv.id;
  let id = steamCfg.id.replace(/\/+$/, '');
  const m = id.match(/steamcommunity\.com\/(?:id|profiles)\/([^/?#]+)/);
  if (m) id = decodeURIComponent(m[1]);
  if (/^\d{17}$/.test(id)) return (steamPriv.id = id);
  const r = await steamGet('ISteamUser', 'ResolveVanityURL', 1, { vanityurl: id });
  if (r.success !== 1 || !r.steamid) throw new Error(`no Steam profile called "${tidy(id, 32)}"`);
  return (steamPriv.id = r.steamid);
}
async function steamLibrary(id) {
  const [own, lvl] = await Promise.all([
    steamGet('IPlayerService', 'GetOwnedGames', 1, { steamid: id, include_appinfo: 1, include_played_free_games: 1 }),
    steamGet('IPlayerService', 'GetSteamLevel', 1, { steamid: id }).catch(() => ({})),
  ]);
  steamPriv.libAt = Date.now();
  if (lvl.player_level != null) steam.level = lvl.player_level | 0;
  const all = (own.games || []).map(g => ({ appid: g.appid | 0, name: String(g.name || `app ${g.appid}`).slice(0, 80),
    min: g.playtime_forever | 0, wk: g.playtime_2weeks | 0, last: g.rtime_last_played | 0, icon: g.img_icon_url || '' }));
  steam.libPrivate = own.game_count === undefined;          // Steam answers {} when "game details" aren't public
  steam.gameCount = own.game_count | 0;
  steam.totalMin = all.reduce((s, g) => s + g.min, 0);
  steam.wkMin = all.reduce((s, g) => s + g.wk, 0);
  // the most played, plus anything played in the last two weeks
  const top = [...all].sort((a, b) => b.min - a.min).slice(0, 40), seen = new Set(top.map(g => g.appid));
  steam.games = [...top, ...all.filter(g => g.wk && !seen.has(g.appid))];
}
async function steamPoll(force = false) {
  if (!steam.configured || steamPriv.busy) return;
  steamPriv.busy = true;
  try {
    const id = await steamResolve();
    const p = ((await steamGet('ISteamUser', 'GetPlayerSummaries', 2, { steamids: id })).players || [])[0];
    if (!p) throw new Error('Steam has no profile with that id');
    const was = steam.playing, appid = +p.gameid || 0;
    // the start is only known if this bridge saw the game begin; a game already running when it starts is "seen"
    steam.playing = p.gameextrainfo ? (was && was.appid === appid ? was : { name: String(p.gameextrainfo).slice(0, 80), appid, since: Date.now(), exact: !steamPriv.first }) : null;
    const ended = was && (!steam.playing || steam.playing.appid !== was.appid);
    steam.profile = { id, name: String(p.personaname || '').slice(0, 32), state: p.personastate | 0, url: p.profileurl || '',
      country: p.loccountrycode || '', since: p.timecreated ? new Date(p.timecreated * 1000).getUTCFullYear() : 0,
      public: p.communityvisibilitystate === 3, avatar: p.avatarhash || '' };
    steamPriv.avaUrl = p.avatarmedium || '';
    if (force || ended || steamPriv.first || Date.now() - steamPriv.libAt > STEAM_LIB_MS) await steamLibrary(id);
    steamPriv.first = false;
    steam.ok = true; steam.err = '';
  } catch (e) {
    steam.err = e.name === 'TimeoutError' ? 'Steam did not answer' : steamScrub(tidy(e.message, 120));
    if (/API key/.test(steam.err)) steamPriv.id = '';
  } finally {
    steamPriv.busy = false; steam.at = Date.now();
    publishSteam();
  }
}
// the avatar, fetched here because the page can't read Steam's CDN; only from Steam's own hosts (or the test API)
const steamHostOK = u => { try { const h = new URL(u).host; return /(^|\.)(steamstatic\.com|akamaihd\.net)$/.test(h) || h === new URL(STEAM_API).host; } catch { return false; } };
async function steamAvatar() {
  const u = steamPriv.avaUrl;
  if (!u || !steamHostOK(u)) return null;
  if (steamPriv.avaFor !== u) {
    const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    steamPriv.ava = Buffer.from(await r.arrayBuffer()); steamPriv.avaFor = u;
  }
  return steamPriv.ava;
}
const publishSteam = () => { const m = `data: ${JSON.stringify(steam)}\n\n`; for (const res of subs.keys()) res.write(m); };
if (!steam.configured) steam.err = !steamCfg.key ? 'no key' : 'no id';
if (steam.configured && !process.env.STEAM_API_KEY && fs.existsSync(STEAM_OLD_FILE) && !fs.existsSync(STEAM_FILE)) { try { steamSave(steamCfg.key, steamCfg.id); } catch {} }

// Setting the key and profile from the web app: tried against Steam first, and only kept (in steam.json, readable by
// you alone) if Steam accepts them. The key is never sent back to a page; the page only learns that one is saved.
function steamSave(key, id) {
  const dir = path.dirname(STEAM_FILE);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch {}
  const tmp = `${STEAM_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ key, id }, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, STEAM_FILE);
  if (STEAM_FILE !== STEAM_OLD_FILE) { try { fs.unlinkSync(STEAM_OLD_FILE); } catch {} }
}
function steamReset() {
  Object.assign(steam, { configured: !!(steamCfg.key && steamCfg.id), ok: false, err: '', at: 0, profile: null, level: 0, playing: null,
    games: [], gameCount: 0, totalMin: 0, wkMin: 0, libPrivate: false, keySet: !!steamCfg.key, idText: steamCfg.id });
  Object.assign(steamPriv, { id: '', libAt: 0, first: true, avaUrl: '', ava: null, avaFor: '' });
  if (!steam.configured) steam.err = !steamCfg.key ? 'no key' : 'no id';
}
async function steamConfigure(c) {
  if (c.clear) {
    steamCfg.key = ''; steamCfg.id = '';
    for (const file of [STEAM_FILE, STEAM_OLD_FILE]) { try { fs.unlinkSync(file); } catch {} }
    steamReset(); publishSteam();
    return { ok: true };
  }
  const key = String(c.key || '').trim() || steamCfg.key, id = String(c.id || '').trim();
  if (!/^[0-9A-Fa-f]{32}$/.test(key)) return { ok: false, err: c.key ? 'a Steam Web API key is 32 letters and digits (0-9, A-F)' : 'enter your API key' };
  if (!id || id.length > 200) return { ok: false, err: 'enter your profile URL, custom name or SteamID64' };
  for (let i = 0; steamPriv.busy && i < 100; i++) await new Promise(r => setTimeout(r, 100));
  const old = { ...steamCfg };
  steamCfg.key = key; steamCfg.id = id;
  steamReset();
  await steamPoll(true);
  if (!steam.ok) {
    const err = steam.err;
    Object.assign(steamCfg, old); steamReset(); if (steam.configured) steamPoll(true); else publishSteam();
    return { ok: false, err };
  }
  steamSave(key, id);
  return { ok: true, name: steam.profile && steam.profile.name };
}

// ── web clients (SSE) ──
const subs = new Map();               // response -> { id, remote }
let clientSeq = 1;
const countRemotes = () => { st.clients = subs.size; st.remotes = [...subs.values()].filter(c => c.remote).length; };
function snapshot() {
  const { clients, ...rest } = st;
  return { type: 'state', elapsed: Math.round((Date.now() - st.since) / 1000), ...rest, clients };
}
function publish(extra) {
  const msg = `data: ${JSON.stringify(snapshot())}\n\n` + (extra ? `data: ${JSON.stringify(extra)}\n\n` : '');
  for (const res of subs.keys()) res.write(msg);
}
setInterval(() => { for (const res of subs.keys()) res.write(`: ping\n\n`); }, 15000);

// ── http ──
function cors(req, res) {
  const o = req.headers.origin;
  if (o && ORIGINS.has(o)) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
}
const body = req => new Promise((ok, bad) => { let b = ''; req.on('data', d => { b += d; if (b.length > 1e6) req.destroy(); }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { bad(e); } }); });
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };

// Only requests addressed to this computer are answered. A web page whose own name has been pointed at 127.0.0.1
// (DNS rebinding) would otherwise count as this site in the browser and could read everything here.
const HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const server = http.createServer(async (req, res) => {
  if (!HOSTS.has(String(req.headers.host || '').toLowerCase())) { res.writeHead(421, { 'Content-Type': 'text/plain' }); return res.end('wrong host'); }
  const url = new URL(req.url, 'http://localhost');
  const origin = req.headers.origin;
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(origin && ORIGINS.has(origin) ? 204 : 403); return res.end(); }
  try {
    // from Claude Code (local scripts never send an Origin header; web pages always do)
    if (req.method === 'POST' && (url.pathname === '/hook' || url.pathname === '/status')) {
      if (origin) return send(res, 403, { error: 'forbidden' });
      const data = await body(req);
      return send(res, 200, url.pathname === '/hook' ? await onHook(data) : (onStatus(data), {}));
    }
    // from the web app
    if (url.pathname === '/steam/avatar') {
      if (origin && !ORIGINS.has(origin)) return send(res, 403, { error: 'origin not allowed' });
      const img = await steamAvatar().catch(() => null);
      if (!img) return send(res, 404, { error: 'no avatar' });
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache' });
      return res.end(img);
    }
    if (url.pathname === '/events' || url.pathname === '/cmd') {
      if (origin && !ORIGINS.has(origin)) return send(res, 403, { error: 'origin not allowed' });
      if (url.pathname === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        const id = clientSeq++;
        subs.set(res, { id, remote: false }); countRemotes();
        res.write(`data: ${JSON.stringify({ type: 'hello', client: id })}\n\n`);
        res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
        res.write(`data: ${JSON.stringify(steam)}\n\n`);
        if (steam.configured && Date.now() - steam.at > STEAM_NOW_MS) steamPoll();
        req.on('close', () => { subs.delete(res); countRemotes(); });
        return;
      }
      if (req.method !== 'POST' || !(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 400, { error: 'json only' });
      const c = await body(req);
      if (c.op === 'perm') return send(res, 200, { ok: answerPerm(+c.id, c.decision === 'allow') });
      if (c.op === 'launch') return send(res, 200, { ok: launch(+c.index) });
      if (c.op === 'steam') { steamPoll(true); return send(res, 200, { ok: steam.configured }); }
      if (c.op === 'steamConfig') return send(res, 200, await steamConfigure(c));
      if (c.op === 'remote') { for (const v of subs.values()) if (v.id === +c.client) v.remote = !!c.on; countRemotes(); publish(); return send(res, 200, { ok: true }); }
      return send(res, 400, { error: 'unknown op' });
    }
    // the web app itself, so http://localhost:7337 works without any cross-site permissions
    if (req.method === 'GET') {
      const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const file = path.resolve(WEB_ROOT, '.' + rel);
      if (!file.startsWith(WEB_ROOT + path.sep) || rel.includes('/.') || /\/(larp-bridge|firmware|scrapped)\//i.test(rel) || /steam\.json/i.test(rel)) return send(res, 404, { error: 'not found' });
      return fs.readFile(file, (err, data) => {
        if (err) return send(res, 404, { error: 'not found' });
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(data);
      });
    }
    send(res, 404, { error: 'not found' });
  } catch (e) { send(res, 500, { error: e.message }); }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`larp-bridge on http://localhost:${PORT}`);
  console.log(`  open http://localhost:${PORT} in Chrome, press Connect, and the charm follows Claude Code.`);
  console.log(`  presets: ${presets.map(p => p.name).join(', ')}`);
  console.log(steam.configured ? '  steam: on (checks what you play every 30 s while a page is open)' : '  steam: off (enter your API key in the web app\'s steam tab)');
  if (steam.configured) steamPoll();
  setInterval(() => { if (subs.size && steam.configured) steamPoll(); }, STEAM_NOW_MS);
});
