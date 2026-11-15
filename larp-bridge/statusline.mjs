#!/usr/bin/env node
// Claude Code status line: prints a compact line and passes the session data (model, cost, context)
// on to larp-bridge so the charm's status page can show it.
import http from 'node:http';
import path from 'node:path';

const PORT = +(process.env.LARP_PORT || 7337);
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  let s = {};
  try { s = JSON.parse(input); } catch {}
  const model = (s.model && (s.model.display_name || s.model.id)) || 'claude';
  const dir = path.basename((s.workspace && s.workspace.current_dir) || s.cwd || '');
  const ctx = s.context_window && s.context_window.used_percentage != null ? ` · ctx ${Math.round(s.context_window.used_percentage)}%` : '';
  const cost = s.cost && s.cost.total_cost_usd != null ? ` · $${s.cost.total_cost_usd.toFixed(2)}` : '';
  const done = linked => { process.stdout.write(`${linked ? '◆' : '◇'} ${model} · ${dir}${ctx}${cost}`); process.exit(0); };
  const req = http.request({ host: '127.0.0.1', port: PORT, path: '/status', method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 300 }, res => { res.resume(); res.on('end', () => done(true)); });
  req.on('timeout', () => { req.destroy(); done(false); });
  req.on('error', () => done(false));
  req.end(input || '{}');
});
