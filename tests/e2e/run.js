// Runs every browser test in this folder one after another. Fails if any prints FAIL/CRASH or exits non-zero.
// A failing file is run once more before it counts as failed (browser tests can be timing-sensitive).
const { spawnSync } = require('child_process'); const fs = require('fs'); const path = require('path');
const only = process.argv[2];
const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.e2e.js') && (!only || f.includes(only))).sort();
function once(f) { const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', timeout: 240000 }); const out = (r.stdout || '') + (r.stderr || '');
  const pass = (out.match(/^PASS/gm) || []).length; const fail = (out.match(/^(FAIL|TEST CRASH|CRASH)/gm) || []).length; return { out, pass, fail, code: r.status, ok: r.status === 0 && fail === 0 && pass > 0 }; }
let bad = 0, total = 0;
for (const f of files) { let r = once(f); let retried = false; if (!r.ok) { retried = true; r = once(f); } total += r.pass;
  console.log((r.ok ? 'ok   ' : 'FAIL ') + f + '  ' + r.pass + ' checks' + (retried ? (r.ok ? ' (passed on retry)' : ' (failed twice)') : ''));
  if (!r.ok) { bad++; console.log(r.out.split('\n').filter((l) => /^(FAIL|TEST CRASH|CRASH)|Error|Timeout/.test(l)).slice(0, 8).join('\n')); } }
console.log(bad ? bad + ' of ' + files.length + ' browser test files failed' : 'All ' + files.length + ' browser test files passed (' + total + ' checks)'); process.exit(bad ? 1 : 0);
