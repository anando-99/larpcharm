#!/usr/bin/env node
// Claude Code hook: forwards the event to larp-bridge. It never gets in Claude's way:
// if the bridge isn't running the hook exits at once and Claude Code carries on as usual.
// For PermissionRequest it waits (up to ~50 s) for an answer from the charm and prints Claude Code's decision JSON.
import http from 'node:http';

const PORT = +(process.env.LARP_PORT || 7337);
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  let event = {};
  try { event = JSON.parse(input); } catch { process.exit(0); }
  const waitForAnswer = event.hook_event_name === 'PermissionRequest';
  const req = http.request({ host: '127.0.0.1', port: PORT, path: '/hook', method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: waitForAnswer ? 50000 : 1500 }, res => {
    let out = '';
    res.on('data', d => { out += d; });
    res.on('end', () => {
      try { const j = JSON.parse(out); if (j && j.hookSpecificOutput) process.stdout.write(JSON.stringify(j)); } catch {}
      process.exit(0);
    });
  });
  req.on('timeout', () => { req.destroy(); process.exit(0); });
  req.on('error', () => process.exit(0));
  req.end(JSON.stringify(event));
});
