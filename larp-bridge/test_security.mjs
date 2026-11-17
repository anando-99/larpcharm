#!/usr/bin/env node
// Safety tests for the Steam key: node larp-bridge/test_security.mjs   (no dependencies; CI runs it on every push)
//
// Runs the real bridge against a stand-in for the Steam Web API, in a throwaway home folder, with a fresh random key,
// then attacks it from every side a web page or another program could: other origins, other Host names (DNS
// rebinding), forms, file paths, error messages. Everything that comes back (every response, the live stream, the
// bridge's own output, the files it writes) is searched for the key. The key must reach Steam and the key file only.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const KEY = crypto.randomBytes(16).toString('hex').toUpperCase();
const KEY2 = crypto.randomBytes(16).toString('hex').toUpperCase();      // a second, valid key, for "someone else"
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'larp-sec-'));
let ok = 0, bad = 0;
const check = (name, cond, detail = '') => { console.log((cond ? '  ok   ' : '  FAIL ') + name + (!cond && detail ? `   [${detail}]` : '')); cond ? ok++ : bad++; };
const seen = [];                       // everything any client got back, searched for the key at the end
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

// ── a stand-in for the Steam Web API: it records which paths each key was sent to ──
let steamMode = 'ok';                  // ok | 500 | junk | slow
const keyUse = [];
const steam = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), key = u.searchParams.get('key');
  keyUse.push({ path: u.pathname, key, headers: JSON.stringify(req.headers) });
  const json = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/avatar.jpg') { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(Buffer.alloc(800, 7)); }
  if (key !== KEY && key !== KEY2) { res.writeHead(403); return res.end('<html><body>Forbidden</body></html>'); }
  if (steamMode === '500') { res.writeHead(500); return res.end('oops ' + key); }
  if (steamMode === 'junk') { res.writeHead(200); return res.end('not json ' + key); }
  switch (u.pathname) {
    case '/ISteamUser/ResolveVanityURL/v1/': return json({ response: { success: 1, steamid: key === KEY ? '76561197960287930' : '76561197960287931' } });
    case '/ISteamUser/GetPlayerSummaries/v2/': return json({ response: { players: [{ steamid: '1', personaname: key === KEY ? 'owner' : 'stranger', personastate: 1,
      avatarmedium: `http://127.0.0.1:${steam.address().port}/avatar.jpg`, avatarhash: 'h', communityvisibilitystate: 3 }] } });
    case '/IPlayerService/GetOwnedGames/v1/': return json({ response: { game_count: 1, games: [{ appid: 1, name: 'A Game', playtime_forever: 60 }] } });
    case '/IPlayerService/GetSteamLevel/v1/': return json({ response: { player_level: 3 } });
  }
  res.writeHead(404); res.end();
});
await new Promise(r => steam.listen(0, '127.0.0.1', r));
const STEAM = `http://127.0.0.1:${steam.address().port}`;

// ── the bridge, as a user would run it, but with its home folder in a temp dir ──
const PORT = await freePort(), BASE = `http://127.0.0.1:${PORT}`, OWN = `http://localhost:${PORT}`;
let out = '';
function startBridge() {
  const p = spawn(process.execPath, [path.join(HERE, 'bridge.mjs')], { env: { PATH: process.env.PATH, HOME: HOME, LARP_PORT: String(PORT), STEAM_API_BASE: STEAM }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
  return p;
}
let bridge = startBridge();
for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/index.html'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }

async function req(p, { method = 'GET', origin, host, type, body, raw } = {}) {
  // raw HTTP, so the Host and Origin headers are exactly what an attacker would send
  return new Promise(resolve => {
    const headers = {};
    if (host !== undefined) headers.Host = host;
    if (origin) headers.Origin = origin;
    if (type) headers['Content-Type'] = type;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers, setHost: host === undefined }, res => {
      let b = Buffer.alloc(0);
      res.on('data', d => { b = Buffer.concat([b, d]); if (raw && b.length > 20000) r.destroy(); });
      res.on('end', () => { seen.push(b.toString('latin1')); resolve({ status: res.statusCode, headers: res.headers, body: b.toString() }); });
      res.on('close', () => resolve({ status: res.statusCode, headers: res.headers, body: b.toString() }));
    });
    r.on('error', () => resolve({ status: 0, headers: {}, body: '' }));
    if (raw) setTimeout(() => r.destroy(), raw);
    r.end(body);
  });
}
const cmd = (body, origin = OWN, extra = {}) => req('/cmd', { method: 'POST', origin, type: 'application/json', body: JSON.stringify(body), ...extra });
const stream = (ms = 700, origin = OWN, host) => req('/events', { origin, host, raw: ms });
const keyFile = path.join(HOME, '.larp-bridge', 'steam.json');
const saved = () => { try { return fs.readFileSync(keyFile, 'utf8'); } catch { return ''; } };

try {
  console.log('setting the key');
  let r = await cmd({ op: 'steamConfig', key: KEY, id: 'owner' });
  check('the page can set a key Steam accepts', r.status === 200 && JSON.parse(r.body).ok, r.body);
  check('the answer does not contain the key', !r.body.includes(KEY));
  check('the key is saved outside the repository, in ~/.larp-bridge/steam.json', fs.existsSync(keyFile));
  check('nothing was written into the repository', !fs.existsSync(path.join(HERE, 'steam.json')) || fs.readFileSync(path.join(HERE, 'steam.json'), 'utf8').indexOf(KEY) < 0);
  if (fs.existsSync(keyFile)) {
    check('the key file is readable by you only (0600)', (fs.statSync(keyFile).mode & 0o777) === 0o600, (fs.statSync(keyFile).mode & 0o777).toString(8));
    check('its folder is yours only (0700)', (fs.statSync(path.dirname(keyFile)).mode & 0o777) === 0o700, (fs.statSync(path.dirname(keyFile)).mode & 0o777).toString(8));
  }
  r = await stream();
  check('the live stream says a key is saved', /"keySet":true/.test(r.body));
  check('the live stream never carries the key', !r.body.includes(KEY));

  console.log('other web pages (a site you visit, or one that pretends to be localhost)');
  for (const o of ['https://evil.example', 'null', 'http://localhost.evil.example', `http://127.0.0.1:${PORT}.evil.example`, 'https://anando-99.github.io.evil.example']) {
    r = await cmd({ op: 'steamConfig', key: '', id: 'someone-else' }, o);
    check(`${o}: cannot set or use the key`, r.status === 403, r.status);
    r = await stream(400, o);
    check(`${o}: cannot read the live stream`, r.status === 403 && !r.body.includes('"type":"steam"'), r.status);
    r = await req('/cmd', { method: 'OPTIONS', origin: o });
    check(`${o}: the browser's preflight is refused, with no CORS grant`, r.status === 403 && !r.headers['access-control-allow-origin'], r.status);
  }
  r = await req('/cmd', { method: 'POST', origin: 'https://evil.example', type: 'application/x-www-form-urlencoded', body: 'op=steamConfig&clear=true' });
  check('a plain HTML form from another site cannot post to it', r.status === 403 || r.status === 400, r.status);
  r = await req('/cmd', { method: 'POST', type: 'text/plain', body: JSON.stringify({ op: 'steamConfig', clear: true }) });
  check('a no-preflight text/plain post is refused (json only)', r.status === 400, r.status);
  check('after all that, the key is still the one you saved', saved().includes(KEY));

  console.log('DNS rebinding (a site whose name is pointed at 127.0.0.1, so the browser thinks it is the same site)');
  for (const h of ['evil.example', `evil.example:${PORT}`, `localhost.evil.example:${PORT}`, '']) {
    const tag = h || '(empty)';
    r = await stream(400, undefined, h);
    check(`Host ${tag}: the live stream is refused`, r.status === 403 || r.status === 400 || r.status === 421, r.status);
    r = await req('/cmd', { method: 'POST', host: h, type: 'application/json', body: JSON.stringify({ op: 'steamConfig', key: '', id: 'x' }) });
    check(`Host ${tag}: commands are refused`, [400, 403, 421].includes(r.status), r.status);
    r = await req('/steam/avatar', { host: h });
    check(`Host ${tag}: the avatar is refused`, [400, 403, 421].includes(r.status), r.status);
    r = await req('/index.html', { host: h });
    check(`Host ${tag}: even the web app's files are refused`, [400, 403, 421].includes(r.status), r.status);
  }

  console.log('reading the key file through the web server');
  const rel = path.relative(REPO, keyFile);
  const tries = ['/larp-bridge/steam.json', '/LARP-BRIDGE/steam.json', '/Larp-Bridge/Steam.json', '/larp-bridge%2fsteam.json', '/%6carp-bridge/steam.json',
    '/./larp-bridge/steam.json', '//larp-bridge/steam.json', '/firmware/../larp-bridge/steam.json', '/%2e%2e/%2e%2e/' + rel, '/..%2f..%2f' + rel,
    '/' + encodeURIComponent(keyFile), '/.larp-bridge/steam.json', '/larp-bridge/steam.json%00.html', '/larp-bridge/bridge.mjs', '/.git/config'];
  const decoy = !fs.existsSync(path.join(HERE, 'steam.json'));               // a stray copy, as an older bridge kept it (never touch a real one)
  if (decoy) fs.writeFileSync(path.join(HERE, 'steam.json'), JSON.stringify({ key: KEY, id: 'decoy' }));
  for (const t of tries) { r = await req(t); check(`GET ${t.slice(0, 60)}: not served`, r.status === 404 && !r.body.includes(KEY), r.status); }
  if (decoy) fs.unlinkSync(path.join(HERE, 'steam.json'));

  console.log('someone else using your key');
  r = await cmd({ op: 'steamConfig', key: '', id: 'someone-else' }, 'https://evil.example');
  check('another site cannot point your key at another profile', r.status === 403, r.status);
  r = await cmd({ op: 'steamConfig', key: 'X'.repeat(32), id: 'owner' });
  check('a malformed key is refused, nothing saved', !JSON.parse(r.body).ok && saved().includes(KEY));
  r = await cmd({ op: 'steamConfig', key: 'F'.repeat(32), id: 'owner' });
  check('a key Steam rejects is refused, and yours is kept', !JSON.parse(r.body).ok && saved().includes(KEY), r.body);

  console.log('error messages');
  for (const m of ['500', 'junk']) {
    steamMode = m;
    await cmd({ op: 'steam' }); await new Promise(r => setTimeout(r, 400));
    r = await stream(500);
    const err = (r.body.match(/"err":"([^"]*)"/g) || []).pop() || '';
    check(`Steam answering ${m === '500' ? 'an error' : 'garbage'}: the error shown has no key`, !r.body.includes(KEY), err);
  }
  steamMode = 'ok'; await cmd({ op: 'steam' }); await new Promise(r => setTimeout(r, 400));

  console.log('where the key went');
  const withKey = keyUse.filter(u => u.key === KEY || u.headers.includes(KEY));
  check('the key was only sent to Steam API calls', withKey.length > 0 && withKey.every(u => /^\/(ISteamUser|IPlayerService)\//.test(u.path)), [...new Set(withKey.map(u => u.path))].join(' '));
  check('the avatar download does not carry the key', keyUse.filter(u => u.path === '/avatar.jpg').every(u => !u.key && !u.headers.includes(KEY)));
  r = await req('/steam/avatar', { origin: OWN });
  check('your page gets the avatar', r.status === 200);

  console.log('restarting the bridge');
  bridge.kill(); await new Promise(r => bridge.on('exit', r));
  bridge = startBridge();
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/index.html'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  await new Promise(r => setTimeout(r, 500));
  r = await stream(800);
  check('it comes back linked, from the saved key', /"keySet":true/.test(r.body) && /"ok":true/.test(r.body));

  console.log('forgetting it');
  r = await cmd({ op: 'steamConfig', clear: true });
  check('forget deletes the key file', JSON.parse(r.body).ok && !fs.existsSync(keyFile));
  r = await stream();
  check('and the bridge no longer has a key', /"keySet":false/.test(r.body));

  console.log('a key saved by the earlier version, inside the repository');
  const old = path.join(HERE, 'steam.json');
  if (!fs.existsSync(old)) {                                  // never touch a real one
    fs.writeFileSync(old, JSON.stringify({ key: KEY, id: 'owner' }));
    bridge.kill(); await new Promise(r => bridge.on('exit', r));
    bridge = startBridge();
    for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/index.html'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    await new Promise(r => setTimeout(r, 300));
    check('it is moved to ~/.larp-bridge at start', saved().includes(KEY) && (fs.statSync(keyFile).mode & 0o777) === 0o600);
    check('and removed from the repository', !fs.existsSync(old));
    try { fs.unlinkSync(old); } catch {}
    await cmd({ op: 'steamConfig', clear: true });
  } else console.log('  skip (you have a larp-bridge/steam.json; start the bridge once and it moves it)');
  r = await req('/status', { method: 'POST', type: 'application/json', body: '{}' });
  check("Claude Code's hooks still get through", r.status === 200, r.status);

  console.log('everything that came back');
  check('no response, stream or page ever contained the key', !seen.some(s => s.includes(KEY)));
  check("the bridge's own output never printed the key", !out.includes(KEY));
  check('the bridge listens on 127.0.0.1 only', await new Promise(r => {
    const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && !i.internal && i.family === 'IPv4').map(i => i.address);
    if (!ips.length) return r(true);
    const s = net.connect(PORT, ips[0]); s.on('connect', () => { s.destroy(); r(false); }); s.on('error', () => r(true));
  }));
  let ignored = true;
  try { execFileSync('git', ['check-ignore', '-q', 'larp-bridge/steam.json'], { cwd: REPO }); } catch { ignored = false; }
  check('a stray larp-bridge/steam.json would be ignored by git', ignored);
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8'), keyInput = (html.match(/<input[^>]*id="stKey"[^>]*>/) || [''])[0];
  check('the key box is not a password field (so password managers do not save and sync it)', keyInput && !/type="password"/.test(keyInput), keyInput);
  check('the key box opts out of autofill and password managers', /autocomplete="off"/.test(keyInput) && /data-1p-ignore/.test(keyInput) && /data-lpignore="true"/.test(keyInput), keyInput);
  const js = fs.readFileSync(path.join(REPO, 'steam.js'), 'utf8');
  check('the page never puts the key in its own storage', !/(localStorage|sessionStorage|indexedDB)[^\n]*stKey/.test(js) && !/stKey[^\n]*(localStorage|sessionStorage)/.test(js));
} finally {
  bridge.kill(); steam.close();
  fs.rmSync(HOME, { recursive: true, force: true });
}
console.log(bad ? `\n${bad} FAILED, ${ok} passed` : `\nall ${ok} checks passed`);
process.exit(bad ? 1 : 0);
