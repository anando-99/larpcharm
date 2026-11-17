// Checks the website without a browser: every script parses, every local file index.html loads exists, the
// scripts' ?v= matches the build meta (so browsers fetch new ones), and the firmware the installers offer is there.
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync('index.html', 'utf8');
let bad = 0;
const fail = m => { console.error('✗ ' + m); bad++; };
const build = (html.match(/<meta name="build" content="([^"]+)"/) || [])[1];
if (!build) fail('no build meta in index.html');
for (const [, src] of html.matchAll(/<script[^>]*src="([^"]+)"/g)) {
  if (/^https?:/.test(src)) continue;
  const [file, q] = src.split('?');
  if (!fs.existsSync(file)) { fail(`${file} is missing`); continue; }
  if (q !== 'v=' + build) fail(`${file}?${q} doesn't match build ${build}`);
  try { new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }); } catch (e) { fail(`${file}: ${e.message}`); }
}
const manifest = JSON.parse(fs.readFileSync('flash/manifest.json', 'utf8'));
for (const p of manifest.builds[0].parts) if (!fs.existsSync('flash/' + p.path)) fail(`flash/${p.path} (in the manifest) is missing`);
const fw = (fs.readFileSync('firmware/LarpCharm/LarpCharm.ino', 'utf8').match(/#define FW_VERSION\s+"([^"]+)"/) || [])[1];
if (manifest.version !== fw) fail(`flash/manifest.json is ${manifest.version} but the firmware is ${fw}: run firmware/tools/release.sh`);
for (const id of ['pairDlg', 'otaBtn', 'spBook', 'heroCv']) if (!html.includes(`id="${id}"`)) fail(`#${id} is missing from index.html`);
console.log(bad ? `${bad} problem(s)` : `website ok: build ${build}, firmware ${fw}`);
process.exit(bad ? 1 : 0);
