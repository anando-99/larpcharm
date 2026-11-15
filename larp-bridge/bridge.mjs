#!/usr/bin/env node
// larp-bridge: links Claude Code on this computer to the Larp Charm.
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

const server = http.createServer(async (req, res) => {
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
    if (url.pathname === '/events' || url.pathname === '/cmd') {
      if (origin && !ORIGINS.has(origin)) return send(res, 403, { error: 'origin not allowed' });
      if (url.pathname === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        const id = clientSeq++;
        subs.set(res, { id, remote: false }); countRemotes();
        res.write(`data: ${JSON.stringify({ type: 'hello', client: id })}\n\n`);
        res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
        req.on('close', () => { subs.delete(res); countRemotes(); });
        return;
      }
      if (req.method !== 'POST' || !(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 400, { error: 'json only' });
      const c = await body(req);
      if (c.op === 'perm') return send(res, 200, { ok: answerPerm(+c.id, c.decision === 'allow') });
      if (c.op === 'launch') return send(res, 200, { ok: launch(+c.index) });
      if (c.op === 'remote') { for (const v of subs.values()) if (v.id === +c.client) v.remote = !!c.on; countRemotes(); publish(); return send(res, 200, { ok: true }); }
      return send(res, 400, { error: 'unknown op' });
    }
    // the web app itself, so http://localhost:7337 works without any cross-site permissions
    if (req.method === 'GET') {
      const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const file = path.resolve(WEB_ROOT, '.' + rel);
      if (!file.startsWith(WEB_ROOT + path.sep) || rel.includes('/.') || /\/(larp-bridge|firmware|scrapped)\//.test(rel)) return send(res, 404, { error: 'not found' });
      return fs.readFile(file, (err, data) => {
        if (err) return send(res, 404, { error: 'not found' });
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
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
});
