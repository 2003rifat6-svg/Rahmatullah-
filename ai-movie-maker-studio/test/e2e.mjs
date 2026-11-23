// End-to-end UI test (mobile viewport). Requires `npm run build` first.
// Uses test/stub-server.ts (stub AI provider, real FFmpeg) — no paid API calls.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const shotsDir = process.env.E2E_SHOTS_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-shots-'));
const pngFile = path.join(shotsDir, 'face.png');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=orange:s=64x64', '-frames:v', '1', pngFile]);

const server = spawn('npx', ['tsx', 'test/stub-server.ts'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'], detached: true });
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => String(d).includes('ready') && resolve());
  server.on('exit', (c) => reject(new Error(`server exited ${c}`)));
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const dialogs = [];
const cspViolations = [];
const watchCsp = (pg) => pg.on('console', (m) => /content security policy/i.test(m.text()) && cspViolations.push(m.text()));
watchCsp(page);
page.on('dialog', (d) => {
  dialogs.push(d.message());
  void d.accept();
});
const step = async (name, fn) => {
  process.stdout.write(`• ${name} ... `);
  await fn();
  console.log('ok');
};
const shot = (n) => page.screenshot({ path: path.join(shotsDir, `${n}.png`), fullPage: true });
const status = () => page.getByTestId('section-status').innerText();
const openHub = async () => {
  await page.getByLabel('Attach files or open project materials').click();
  await page.getByRole('button', { name: /OPEN PROJECT MATERIALS/ }).click();
};
const chatCount = () => page.locator('main[aria-label="AI Main Chat Box"] > div').count();

try {
  await page.goto(BASE);
  const initialChat = await chatCount();

  await step('Hub shows 8 sections, all UNLOCKED on first open', async () => {
    await openHub();
    for (const key of ['story', 'characters', 'character_refs', 'image_prompts', 'video_prompts', 'production_settings', 'generated_images', 'generated_videos']) {
      const t = await page.getByTestId(`hub-status-${key}`).innerText();
      assert.ok(!t.startsWith('Locked'), `${key}: ${t}`);
    }
    await shot('01-hub');
  });

  await step('Story: Save keeps UNLOCKED, Lock disables, Unlock re-enables', async () => {
    await page.getByTestId('hub-story').click();
    assert.match(await status(), /Unlocked/);
    const editor = page.getByLabel('Story Master editor');
    await editor.fill('Rahim walks along the river at dawn.');
    await page.getByRole('button', { name: 'Save' }).click();
    assert.match(await status(), /Saved · Unlocked/);
    assert.equal(await editor.isEnabled(), true);
    await page.getByRole('button', { name: 'Lock' }).click();
    assert.match(await status(), /Locked/);
    assert.equal(await editor.isEnabled(), false);
    assert.equal(await page.getByRole('button', { name: 'Upload File' }).isEnabled(), false);
    await page.getByRole('button', { name: 'Unlock' }).click();
    assert.equal(await editor.isEnabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Upload File' }).isEnabled(), true);
    await editor.fill('Rahim walks along the river at dawn. Edited but not saved.');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    assert.ok(dialogs.pop()?.includes('Unsaved'));
    await page.getByTestId('hub-story').waitFor();
    assert.match(await page.getByTestId('hub-status-story').innerText(), /Saved · Unlocked/);
  });

  await step('Character: new card is a draft until Save; incomplete card is not in project', async () => {
    await page.getByTestId('hub-characters').click();
    await page.getByRole('button', { name: 'Add New Character' }).click();
    await page.getByLabel('Character 1 Information').fill('Name: Rahim\nAge: 30\nClothing: white panjabi');
    await page.getByRole('button', { name: 'Save Character' }).click();
    await page.getByRole('button', { name: 'Add New Character' }).click();
    await page.getByLabel('Character 2 Information').fill('Name: Draft Person');
    await shot('02-characters');
    await page.getByRole('button', { name: 'Project Materials (back)' }).click();
    assert.ok(dialogs.pop()?.includes('Unsaved'));
    assert.match(await page.getByTestId('hub-characters').innerText(), /1 saved · 0 complete/);
  });

  await step('Reference images: 4 slots; upload + Save + Lock/Unlock Face', async () => {
    await page.getByTestId('hub-character_refs').click();
    for (const s of ['Face', 'Front Body', 'Side Body', 'Back Body']) {
      await page.getByRole('region', { name: `${s} reference` }).waitFor();
    }
    const face = page.getByRole('region', { name: 'Face reference' });
    await face.locator('input[type=file]').setInputFiles(pngFile);
    await face.getByRole('button', { name: 'Save Face' }).click();
    await face.getByRole('button', { name: 'Lock' }).click();
    assert.equal(await face.getByLabel('Face prompt').isEnabled(), false);
    await face.getByRole('button', { name: 'Unlock' }).click();
    assert.equal(await face.getByLabel('Face prompt').isEnabled(), true);
    await shot('03-references');
    await page.getByRole('button', { name: 'Back to Project Materials' }).click();
    assert.match(await page.getByTestId('hub-characters').innerText(), /1 complete/);
  });

  const fillAndLock = async (hubKey, label, text) => {
    await page.getByTestId(`hub-${hubKey}`).click();
    await page.getByLabel(label).fill(text);
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('button', { name: 'Lock' }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
  };

  await step('Lock story, prompts, settings and character', async () => {
    await page.getByTestId('hub-story').click();
    await page.getByRole('button', { name: 'Lock' }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await fillAndLock('image_prompts', 'Image Prompts editor', 'S01 | SH01 | Rahim walks by the river\nS01 | SH02 | Close-up of Rahim smiling');
    await fillAndLock('video_prompts', 'Video Prompts editor', 'S01 | SH01 | Slow tracking shot of Rahim\nS01 | SH02 | FAIL_ONCE gentle push-in on Rahim');
    await page.getByTestId('hub-production_settings').click();
    await page.getByRole('button', { name: /^Save/ }).click();
    await page.getByRole('button', { name: 'Lock' }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByTestId('hub-characters').click();
    await page.getByRole('button', { name: 'Lock' }).first().click();
    await page.getByRole('button', { name: 'Project Materials (back)' }).click();
    assert.match(await page.getByTestId('hub-status-characters').innerText(), /Locked/);
  });

  await step('No section posted anything to Main Chat by itself', async () => {
    await page.getByRole('button', { name: 'Main Chat', exact: true }).click();
    assert.equal(await chatCount(), initialChat);
  });

  await step('Send All Materials → one organised bundle in Main Chat', async () => {
    await openHub();
    await page.getByRole('button', { name: 'Send All Materials to Main Chat' }).click();
    assert.equal(await chatCount(), initialChat + 2);
    await page.getByRole('button', { name: 'Show full bundle' }).click();
    const pre = await page.locator('pre').innerText();
    assert.ok(pre.includes('[2] CHARACTER INFORMATION') && pre.includes('Rahim') && !pre.includes('Draft Person'));
    assert.ok(pre.includes('S01 | SH02'));
    await shot('04-chat-bundle');
  });

  await step('Without backend: generation honestly disabled', async () => {
    await openHub();
    await page.getByTestId('hub-generated_images').click();
    await page.getByText('Backend not connected').waitFor();
    await page.getByRole('button', { name: /Generate missing/ }).click();
    await page.getByText(/Backend is not connected/).waitFor();
    assert.equal(await page.getByTestId('shot-status-S01-SH01').innerText(), 'No output yet');
  });

  await step('Connect backend (own server) via Cloud Settings', async () => {
    await page.getByRole('button', { name: 'Open Cloud Settings' }).click();
    await page.getByRole('button', { name: /Use this app/ }).click();
    await page.getByRole('button', { name: 'Test Backend Connection' }).click();
    await page.getByText('Connected', { exact: true }).waitFor();
    await page.getByRole('button', { name: /Chat/ }).first().click();
  });

  await step('Step 1: generate shot images (confirm dialog), Save + Lock', async () => {
    await openHub();
    await page.getByTestId('hub-generated_images').click();
    await page.getByRole('button', { name: 'Generate missing (2)' }).click();
    await page.getByRole('dialog', { name: 'Confirm paid generation' }).getByRole('button', { name: 'Yes, generate' }).click();
    await page.getByTestId('shot-status-S01-SH02').filter({ hasText: 'AI generated' }).waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Save Selection' }).click();
    await page.getByRole('button', { name: 'Lock' }).click();
    assert.equal(await page.getByRole('button', { name: /Generate missing/ }).isEnabled(), false);
    await shot('05-generated-images');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
  });

  await step('Version history: 10 versions kept (old cap was 8), reload keeps all, old version selectable', async () => {
    await page.getByTestId('hub-generated_images').click(); // previous step ended on the Materials Hub
    await page.getByRole('button', { name: 'Unlock' }).click();
    const shotRegion = page.getByRole('region', { name: 'Shot S01-SH01' });
    for (let n = 2; n <= 10; n++) {
      await shotRegion.getByRole('button', { name: 'Regenerate' }).click();
      await page.getByRole('dialog', { name: 'Confirm paid generation' }).getByRole('button', { name: 'Yes, generate' }).click();
      await page.getByTestId('versions-toggle-S01-SH01').filter({ hasText: `(${n})` }).waitFor({ timeout: 15000 });
    }
    await page.getByRole('button', { name: 'Save Selection' }).click();
    // reload the whole app: versions come back from the separate media store
    await page.waitForTimeout(500);
    await page.reload();
    await openHub();
    await page.getByTestId('hub-generated_images').click();
    const toggle = page.getByTestId('versions-toggle-S01-SH01');
    await toggle.filter({ hasText: '(10)' }).waitFor();
    await toggle.click();
    assert.equal(await page.locator('[data-testid^="version-S01-SH01-"]').count(), 10);
    // every stored version still renders a real image (blob URL from the media store)
    const loaded = await page.locator('[data-testid^="version-S01-SH01-"] img').evaluateAll((imgs) => imgs.map((i) => i.complete && i.naturalWidth > 0));
    assert.equal(loaded.length, 10);
    assert.ok(loaded.every(Boolean), 'all 10 versions load their image after reload');
    // after a reload the files are blob: URLs from the media store: downloading one must work (Content-Security-Policy allows reading them)
    const [versionDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download version 3 of S01-SH01/ }).click()]);
    assert.match(versionDownload.suggestedFilename(), /_S01_SH01_v3\.(jpg|png|webp)$/);
    // select the very first version again
    const v1 = page.getByTestId('version-S01-SH01-1');
    await v1.getByRole('button', { name: 'Use this' }).click();
    await v1.getByText('current').waitFor();
    // removal needs an explicit confirmation and affects only that version
    await page.getByTestId('version-S01-SH01-10').getByRole('button', { name: /Remove version 10/ }).click();
    await toggle.filter({ hasText: '(9)' }).waitFor();
    await page.getByRole('button', { name: 'Save Selection' }).click();
    await page.getByRole('button', { name: 'Lock' }).click();
    await shot('05b-versions');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
  });

  await step('Step 2: videos from the images, then FFmpeg movie assembly', async () => {
    await page.getByTestId('hub-generated_videos').click();
    await page.getByRole('button', { name: 'Generate missing (2)' }).click();
    await page.getByRole('button', { name: 'Yes, generate' }).click();
    await page.getByText('Video job running on server…').first().waitFor();
    // S01-SH01 succeeds; S01-SH02 fails on purpose the first time (stub: FAIL_ONCE) -> real error is shown, nothing fake
    await page.getByTestId('shot-status-S01-SH01').filter({ hasText: 'AI generated' }).waitFor({ timeout: 60000 });
    await page.getByTestId('shot-status-S01-SH02').filter({ hasText: 'Failed' }).waitFor({ timeout: 60000 });
    await page.getByRole('region', { name: 'Shot S01-SH02' }).getByText(/stub video failure/).waitFor();
    assert.equal(await page.getByRole('region', { name: 'Shot S01-SH02' }).locator('video').count(), 0, 'a failed shot shows no video');
    // one click retries every failed shot (a NEW job: new idempotency key, linked to the failed one)
    const retry = page.getByTestId('retry-failed');
    assert.match(await retry.innerText(), /Retry failed \(1\)/);
    await retry.click();
    await page.getByRole('button', { name: 'Yes, generate' }).click();
    await page.getByTestId('shot-status-S01-SH02').filter({ hasText: 'AI generated' }).waitFor({ timeout: 60000 });
    assert.equal(await page.getByTestId('retry-failed').count(), 0, 'nothing left to retry');
    await page.getByTestId('versions-toggle-S01-SH02').filter({ hasText: '(1)' }).waitFor();
    await page.getByRole('button', { name: 'Check the server for finished videos' }).click();
    await page.getByText(/Nothing to recover/).waitFor();
    await page.getByRole('button', { name: 'Assemble Movie (MP4)' }).click();
    await page.getByRole('link', { name: 'Download movie MP4' }).waitFor({ timeout: 30000 });
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Videos ZIP' }).click();
    const file = await dl;
    assert.match(file.suggestedFilename(), /_Videos\.zip$/);
    await shot('06-generated-videos');
  });

  // ---- AI Story Analysis in its own, fresh project (own browser profile) ----
  const STORY = 'Rahim is a poor boatman who rows the river every dawn. One night a storm sinks his boat and he saves a young woman named Nila from the water.';
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ctx2.newPage();
  watchCsp(p2);
  p2.on('dialog', (d) => void d.accept());
  const hub2 = async () => {
    await p2.getByLabel('Attach files or open project materials').click();
    await p2.getByRole('button', { name: /OPEN PROJECT MATERIALS/ }).click();
  };
  await step('Story analysis: draft only; edits and reload keep it; nothing becomes material until Save', async () => {
    await p2.goto(BASE);
    await p2.getByRole('button', { name: 'Cloud and Cost Settings' }).click();
    await p2.getByRole('button', { name: /Use this app/ }).click();
    await p2.getByRole('button', { name: 'Test Backend Connection' }).click();
    await p2.getByText('Connected', { exact: true }).waitFor();
    await p2.getByRole('button', { name: /Chat/ }).first().click();
    await hub2();
    await p2.getByTestId('hub-story').click();
    await p2.getByLabel('Story Master editor').fill(STORY);
    await p2.getByRole('button', { name: 'Save' }).click();
    await p2.getByRole('button', { name: /AI Story Analysis/ }).click();
    await p2.getByRole('button', { name: 'Analyze', exact: true }).click(); // confirm dialog (paid API notice) auto-accepted
    await p2.getByText('DRAFT — not saved as project materials').waitFor({ timeout: 30000 });
    await p2.getByRole('heading', { name: /Scenes & shots \(6 selected\)/ }).waitFor();
    await p2.getByRole('button', { name: /S01.*Scene 1/ }).waitFor();
    await p2.screenshot({ path: path.join(shotsDir, '07-story-draft.png'), fullPage: true });
    const prompt = p2.getByLabel('Image prompt S01-SH01');
    await prompt.fill('EDITED prompt: Rahim rows at dawn.');
    await prompt.blur();
    await p2.waitForTimeout(500);
    // reload: the (paid) draft and the user's edit survive
    await p2.reload();
    await hub2();
    assert.match(await p2.getByTestId('hub-status-image_prompts').innerText(), /Empty/, 'a draft is not a material');
    assert.match(await p2.getByTestId('hub-status-characters').innerText(), /Empty/);
    await p2.getByTestId('hub-story').click();
    await p2.getByRole('button', { name: /AI Story Analysis/ }).click();
    await p2.getByText('DRAFT — not saved as project materials').waitFor();
    assert.equal(await p2.getByLabel('Image prompt S01-SH01').inputValue(), 'EDITED prompt: Rahim rows at dawn.');
    // leave one shot out, then save as materials
    await p2.getByRole('button', { name: /S03/ }).click();
    await p2.getByLabel('Include shot S03-SH01').uncheck();
    await p2.getByRole('button', { name: 'Save as Project Materials' }).click();
    await p2.getByText(/Characters added: 2/).waitFor();
    await p2.getByText(/Image Prompts: 5 shot\(s\) saved/).waitFor();
    await p2.getByRole('button', { name: 'Story Master' }).click();
    await p2.getByRole('button', { name: 'Project Materials (back)' }).click();
    assert.match(await p2.getByTestId('hub-status-image_prompts').innerText(), /Saved · Unlocked/);
    assert.match(await p2.getByTestId('hub-status-video_prompts').innerText(), /Saved · Unlocked/);
    assert.match(await p2.getByTestId('hub-characters').innerText(), /2 saved · 0 complete/, 'characters need reference images before they count as complete');
    assert.doesNotMatch(await p2.getByTestId('hub-status-characters').innerText(), /Locked/);
    // prompts keep the user's edit and the left-out shot is gone
    await p2.getByTestId('hub-image_prompts').click();
    const text = await p2.getByLabel('Image Prompts editor').inputValue();
    assert.ok(text.includes('S01 | SH01 | EDITED prompt: Rahim rows at dawn.'));
    assert.ok(!text.includes('S03 | SH01'));
    assert.equal(text.split('\n').length, 5);
    await p2.getByRole('button', { name: 'Back', exact: true }).click();
    // nothing was generated automatically
    await p2.getByTestId('hub-generated_images').click();
    assert.equal(await p2.getByText('No output yet').count() >= 5, true);
    assert.match(await p2.getByTestId('hub-status-generated_images').innerText().catch(() => 'Empty'), /Empty|^$/);
  });
  await ctx2.close();

  assert.deepEqual(cspViolations, [], 'the browser reported Content-Security-Policy violations');
  console.log(`\nE2E PASSED. Screenshots: ${shotsDir}`);
} catch (err) {
  await shot('zz-failure').catch(() => {});
  console.error('\nE2E FAILED:', err);
  process.exitCode = 1;
} finally {
  await browser.close();
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {}
}
