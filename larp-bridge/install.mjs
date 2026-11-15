#!/usr/bin/env node
// Adds the larp-bridge hooks (and, if you have none, a status line) to ~/.claude/settings.json.
// Keeps a backup, never touches hooks that aren't ours, and `--uninstall` takes ours back out.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(os.homedir(), '.claude', 'settings.json');
const HOOK = `node "${path.join(HERE, 'hook.mjs')}"`;
const LINE = `node "${path.join(HERE, 'statusline.mjs')}"`;
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'Notification', 'Stop', 'SessionEnd'];
const ours = h => typeof h.command === 'string' && h.command.includes('larp-bridge');

const uninstall = process.argv.includes('--uninstall');
let cfg = {};
if (fs.existsSync(FILE)) {
  cfg = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const backup = `${FILE}.larp-backup-${Date.now()}`;
  fs.copyFileSync(FILE, backup);
  console.log(`backup: ${backup}`);
}
cfg.hooks = cfg.hooks || {};
for (const ev of EVENTS) {
  const groups = (cfg.hooks[ev] || []).map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !ours(h)) })).filter(g => g.hooks.length);
  if (!uninstall) groups.push({ matcher: '', hooks: [{ type: 'command', command: HOOK, timeout: ev === 'PermissionRequest' ? 60 : 5 }] });
  if (groups.length) cfg.hooks[ev] = groups; else delete cfg.hooks[ev];
}
if (!Object.keys(cfg.hooks).length) delete cfg.hooks;
if (uninstall) { if (cfg.statusLine && ours(cfg.statusLine)) delete cfg.statusLine; }
else if (!cfg.statusLine) cfg.statusLine = { type: 'command', command: LINE };
else if (!ours(cfg.statusLine)) console.log('you already have a status line, so it stays; the charm will show less on its status page');

fs.mkdirSync(path.dirname(FILE), { recursive: true });
fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2) + '\n');
console.log(uninstall ? 'larp-bridge hooks removed.' : `larp-bridge hooks installed for: ${EVENTS.join(', ')}`);
