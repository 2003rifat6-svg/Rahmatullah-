// End-to-end Cloud Sync UI test on the Firestore + GCS emulators (STUB_CLOUD=1 stub server).
// Two "devices" of the same user, plus a second user, in a phone-sized browser.
// Sign-in uses the test verifier through the real /api/auth/session endpoint
// (Google's sign-in popup itself cannot run in an automated test).
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const PORT = 8798;
const BASE = `http://127.0.0.1:${PORT}`;
const shotsDir = process.env.E2E_SHOTS_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-cloud-'));
const pngFile = path.join(shotsDir, 'face-cloud.png');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x640', '-frames:v', '1', pngFile]);

const server = spawn('npx', ['tsx', 'test/stub-server.ts'], {
  env: { ...process.env, PORT: String(PORT), STUB_CLOUD: '1' },
  stdio: ['ignore', 'pipe', 'inherit'],
  detached: true,
});
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => String(d).includes('ready') && resolve());
  server.on('exit', (c) => reject(new Error(`server exited ${c}`)));
});

const browser = await chromium.launch();
const step = async (name, fn) => {
  process.stdout.write(`• ${name} ... `);
  await fn();
  console.log('ok');
};

async function device(credential) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('dialog', (d) => void d.accept());
  await page.goto(BASE);
  // Connect backend from the UI
  await page.getByRole('button', { name: 'Cloud and Cost Settings' }).click();
  await page.getByRole('button', { name: /Use this app/ }).click();
  await page.getByRole('button', { name: 'Test Backend Connection' }).click();
  await page.getByText('Connected', { exact: true }).waitFor();
  // Sign in through the real session endpoint (cookie lands in this browser context)
  const res = await page.request.post(`${BASE}/api/auth/session`, { data: { credential }, headers: { 'X-Requested-With': 'mms' } });
  assert.equal(res.status(), 200);
  await page.reload();
  await page.getByRole('button', { name: 'Cloud and Cost Settings' }).click();
  await page.getByTestId('cloud-user').waitFor();
  return { ctx, page };
}

const panel = (page) => page.getByRole('region', { name: 'Cloud Sync' });

let A;
try {
  const page0 = null;
  await step('Device A: connect + sign in', async () => {
    A = await device('test:alice1:alice@x.com');
    assert.match(await A.page.getByTestId('cloud-user').innerText(), /alice@x\.com/);
  });

  await step('Device A: local work (story + character face image) saved in browser only', async () => {
    const p = A.page;
    await p.getByRole('button', { name: /Chat/ }).first().click();
    await p.getByLabel('Attach files or open project materials').click();
    await p.getByRole('button', { name: /OPEN PROJECT MATERIALS/ }).click();
    await p.getByTestId('hub-story').click();
    await p.getByLabel('Story Master editor').fill('Cloud story: the boat leaves at dawn.');
    await p.getByRole('button', { name: 'Save' }).click();
    await p.getByRole('button', { name: 'Back', exact: true }).click();
    await p.getByTestId('hub-characters').click();
    await p.getByRole('button', { name: 'Add New Character' }).click();
    await p.getByLabel('Character 1 Information').fill('Name: Nila\nAge: 22');
    await p.getByRole('button', { name: 'Save Character' }).click();
    await p.getByRole('button', { name: 'Reference Images' }).click();
    const face = p.getByRole('region', { name: 'Face reference' });
    await face.locator('input[type=file]').setInputFiles(pngFile);
    await face.getByRole('button', { name: 'Save Face' }).click();
    const src = await face.locator('img').getAttribute('src');
    assert.ok(src.startsWith('data:image/'), 'before cloud save the image is local (data URL)');
  });

  await step('Device A: Save to Cloud → Firestore revision 1; image moved to Cloud Storage', async () => {
    const p = A.page;
    await p.getByRole('button', { name: 'Back to Project Materials' }).click();
    await p.getByRole('button', { name: 'Main Chat', exact: true }).click();
    await p.getByRole('button', { name: 'Cloud and Cost Settings' }).click();
    await panel(p).getByRole('button', { name: /Save “.*” to Cloud/ }).click();
    await panel(p).getByText('Saved to cloud (revision 1).').waitFor();
    await panel(p).getByText(/rev 1/).waitFor();
    await p.screenshot({ path: path.join(shotsDir, '10-cloud-panel.png'), fullPage: true });
  });

  let B;
  await step('Device B (same user): sees the cloud project and loads it with the image', async () => {
    B = await device('test:alice1:alice@x.com');
    const p = B.page;
    await panel(p).getByRole('button', { name: 'Load', exact: true }).click();
    await panel(p).getByText(/Loaded ".*" from the cloud/).waitFor();
    await p.getByRole('button', { name: /Chat/ }).first().click();
    await p.getByLabel('Attach files or open project materials').click();
    await p.getByRole('button', { name: /OPEN PROJECT MATERIALS/ }).click();
    await p.getByTestId('hub-story').click();
    assert.equal(await p.getByLabel('Story Master editor').inputValue(), 'Cloud story: the boat leaves at dawn.');
    await p.getByRole('button', { name: 'Back', exact: true }).click();
    await p.getByTestId('hub-character_refs').click();
    const img = p.getByRole('region', { name: 'Face reference' }).locator('img');
    assert.match(await img.getAttribute('src'), /^\/api\/media\/users\/alice1\/projects\/.*\/assets\/.*\.(png|jpg)$/);
    assert.ok(await img.evaluate((el) => el.complete && el.naturalWidth === 640), 'image loads from Cloud Storage via the session cookie');
    // Edit on B and save → revision 2
    await p.getByRole('button', { name: 'Back to Project Materials' }).click();
    await p.getByTestId('hub-story').click();
    await p.getByLabel('Story Master editor').fill('Edited on device B.');
    await p.getByRole('button', { name: 'Save' }).click();
    await p.getByRole('button', { name: 'Back', exact: true }).click();
    await p.getByRole('button', { name: 'Main Chat', exact: true }).click();
    await p.getByRole('button', { name: 'Cloud and Cost Settings' }).click();
    await panel(p).getByRole('button', { name: /Save “.*” to Cloud/ }).click();
    await panel(p).getByText('Saved to cloud (revision 2).').waitFor();
  });

  await step('Device A: stale save → conflict warning → overwrite (revision 3)', async () => {
    const p = A.page;
    let conflictSeen = false;
    p.removeAllListeners('dialog');
    p.on('dialog', (d) => {
      if (d.message().includes('changed elsewhere')) conflictSeen = true;
      void d.accept();
    });
    await panel(p).getByRole('button', { name: /Save “.*” to Cloud/ }).click();
    await panel(p).getByText('Saved to cloud (revision 3).').waitFor();
    assert.ok(conflictSeen, 'user was asked before overwriting a newer cloud copy');
  });

  await step('Cloud files: upload → listed → delete', async () => {
    const p = A.page;
    await panel(p).locator('input[type=file]').setInputFiles(pngFile);
    await panel(p).getByText('Uploaded "face-cloud.png" to Cloud Storage.').waitFor();
    await panel(p).getByRole('button', { name: /Delete face-cloud_.*\.png/ }).click();
    await panel(p).getByText(/Deleted face-cloud_/).waitFor();
  });

  await step('Second user (Bob) sees none of Alice’s projects', async () => {
    const bob = await device('test:bob2:bob@x.com');
    await panel(bob.page).getByText('No cloud projects yet.').waitFor();
    const direct = await bob.page.request.get(`${BASE}/api/projects`);
    assert.deepEqual((await direct.json()).projects, []);
    await bob.ctx.close();
  });

  await step('Delete from cloud keeps the local copy (local save unaffected)', async () => {
    const p = A.page;
    await panel(p).getByRole('button', { name: /Delete .* from cloud/ }).click();
    await panel(p).getByText(/Deleted from the cloud/).waitFor();
    await panel(p).getByText('No cloud projects yet.').waitFor();
    await p.reload();
    await p.getByLabel('Attach files or open project materials').click();
    await p.getByRole('button', { name: /OPEN PROJECT MATERIALS/ }).click();
    await p.getByTestId('hub-story').click();
    assert.match(await p.getByLabel('Story Master editor').inputValue(), /dawn/);
  });

  console.log(`\nCLOUD E2E PASSED. Screenshots: ${shotsDir}`);
} catch (err) {
  try {
    const live = await A.page.locator('[aria-label="Cloud Sync"]').first().innerText({ timeout: 3000 });
    console.error('\nCloud Sync panel text at failure:\n' + live.slice(0, 700));
  } catch {}
  console.error('\nCLOUD E2E FAILED:', err);
  process.exitCode = 1;
} finally {
  await browser.close();
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {}
}
