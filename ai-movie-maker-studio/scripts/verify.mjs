// One command that runs every check and prints an honest summary.
//   npm run verify            (needs: npm ci, Chromium for the E2E tests, emulators for the Firestore/GCS tests)
// Each step is PASS, FAIL or SKIPPED (with the reason). A skipped step is never reported as passed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const steps = [];
const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-'));
const has = (cmd, args = ['--version']) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;
const emulatorJar = () => {
  const dir = path.join(os.homedir(), '.cache/firebase/emulators');
  return fs.existsSync(dir) && fs.readdirSync(dir).some((f) => /^cloud-firestore-emulator.*\.jar$/.test(f));
};
const fakeGcs = () => fs.existsSync(process.env.FAKE_GCS_BIN || path.join(os.homedir(), 'go/bin/fake-gcs-server'));
const chromium = () => {
  try {
    return fs.existsSync(spawnSync(process.execPath, ['-e', "import('playwright').then(m=>console.log(m.chromium.executablePath()))"], { encoding: 'utf8' }).stdout.trim());
  } catch {
    return false;
  }
};

function run(name, cmd, args, { skip } = {}) {
  if (skip) {
    steps.push({ name, status: 'SKIPPED', detail: skip });
    console.log(`- ${name}: SKIPPED (${skip})`);
    return;
  }
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const file = path.join(logDir, `${steps.length + 1}-${name.replace(/\W+/g, '_')}.log`);
  fs.writeFileSync(file, out);
  const counts = /# tests (\d+)[\s\S]*?# pass (\d+)[\s\S]*?# fail (\d+)/.exec(out);
  const detail = counts ? `${counts[2]}/${counts[1]} passed, ${counts[3]} failed` : '';
  const ok = r.status === 0;
  steps.push({ name, status: ok ? 'PASS' : 'FAIL', detail, log: file, secs: Math.round((Date.now() - t0) / 1000) });
  console.log(`- ${name}: ${ok ? 'PASS' : 'FAIL'} ${detail} (${Math.round((Date.now() - t0) / 1000)}s)${ok ? '' : `\n    log: ${file}`}`);
}

const npm = (script) => ['npm', ['run', '--silent', script]];
run('lint (TypeScript app + server)', ...npm('lint'));
run('unit + security + deploy-guard + PWA-file tests', ...npm('test:unit'));
const emuSkip = !has('java', ['-version']) ? 'Java not found (needed by the Firestore emulator)' : !emulatorJar() ? 'Firestore emulator jar missing (npm run emulators:setup)' : !fakeGcs() ? 'fake-gcs-server missing (npm run emulators:setup)' : undefined;
run('integration tests (Firestore + GCS emulators)', ...npm('test:integration'), { skip: emuSkip });
run('frontend + server build', ...npm('build'));
const e2eSkip = chromium() ? undefined : 'Playwright Chromium not installed (npx playwright install chromium)';
run('mobile E2E: local', ...npm('test:e2e'), { skip: e2eSkip });
run('mobile E2E: cloud sync (emulators)', ...npm('test:e2e:cloud'), { skip: e2eSkip || emuSkip });
run('mobile E2E: PWA', ...npm('test:e2e:pwa'), { skip: e2eSkip });
run('dependency audit (runtime packages)', 'npm', ['audit', '--omit=dev']);

const failed = steps.filter((s) => s.status === 'FAIL').length;
const skipped = steps.filter((s) => s.status === 'SKIPPED').length;
console.log(`\n${steps.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped. Logs: ${logDir}`);
if (skipped) console.log('NOTE: skipped steps were NOT verified.');
process.exit(failed ? 1 : 0);
