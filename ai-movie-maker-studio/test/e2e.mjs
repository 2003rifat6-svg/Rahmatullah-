// End-to-end UI test (mobile viewport). Requires `npm run build` first.
// Uses test/stub-server.ts (stub AI provider, real FFmpeg) — no paid API calls.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
// Uses the pre-installed Playwright if it is not a project dependency.
const { chromium } = createRequire(import.meta.url)('playwright');

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
    await fillAndLock('video_prompts', 'Video Prompts editor', 'S01 | SH01 | Slow tracking shot of Rahim\nS01 | SH02 | Gentle push-in on Rahim');
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

  await step('Step 2: videos from the images, then FFmpeg movie assembly', async () => {
    await page.getByTestId('hub-generated_videos').click();
    await page.getByRole('button', { name: 'Generate missing (2)' }).click();
    await page.getByRole('button', { name: 'Yes, generate' }).click();
    await page.getByText('Video job running on server…').first().waitFor();
    await page.getByTestId('shot-status-S01-SH02').filter({ hasText: 'AI generated' }).waitFor({ timeout: 60000 });
    await page.getByTestId('shot-status-S01-SH01').filter({ hasText: 'AI generated' }).waitFor({ timeout: 60000 });
    await page.getByRole('button', { name: 'Assemble Movie (MP4)' }).click();
    await page.getByRole('link', { name: 'Download movie MP4' }).waitFor({ timeout: 30000 });
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Videos ZIP' }).click();
    const file = await dl;
    assert.match(file.suggestedFilename(), /_Videos\.zip$/);
    await shot('06-generated-videos');
  });

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
