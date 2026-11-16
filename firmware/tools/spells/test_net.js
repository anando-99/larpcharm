// Checks the website's spell engine (spells-net.js) against PyTorch:  node firmware/tools/spells/test_net.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..', '..', '..');
globalThis.atob = s => Buffer.from(s, 'base64').toString('binary');
const ctx = { atob: globalThis.atob, Float32Array, Uint8Array, Math, console }; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'spells-model.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'spells-net.js'), 'utf8'), ctx);
const tv = JSON.parse(fs.readFileSync(path.join(__dirname, 'model', 'testvec.json'), 'utf8'));
let bad = 0;
for (const t of tv) {
  const raw = Int16Array.from(t.raw), r = ctx.SpellNet.classify(raw, t.n, 4096, 16);
  const md = Math.max(...t.emb.map((v, i) => Math.abs(v - r.emb[i])));
  console.log(`${t.label.padEnd(8)} fingerprint max diff vs pytorch ${md.toExponential(2)}   ${r.scores[0].label} ${r.scores[0].sim.toFixed(3)} -> ${r.label || 'no match'} ${md < 1e-3 ? 'ok' : 'MISMATCH'}`);
  bad += md >= 1e-3;
}
console.log(bad ? 'FAILED' : 'all match'); process.exit(bad ? 1 : 0);
