/**
 * Version history tests: unlimited versions, separate media storage, reload persistence,
 * explicit-only deletion. IndexedDB is simulated by fake-indexeddb (same API as the browser).
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { createBlankProject } from '../src/data/sampleProject';
import type { MovieProject, ParsedPromptEntry } from '../src/types/studio';
import { cleanUnusedMedia, externalizeMedia, formatBytes, _resetMediaCachesForTests, mediaReport, MEDIA_STORE, rehydrateMedia } from '../src/utils/mediaStore';
import { loadStudioState, openStudioDb, saveStudioState } from '../src/utils/storage';
import { addVersion, removeVersion, selectVersion, versionNumber } from '../src/utils/versions';
import { parsePromptsFromRawText } from '../src/utils/validation';

/** A distinct ~12 KB PNG-looking data URL per index. */
function fakeImage(i: number): string {
  const bytes = Buffer.alloc(9000, i % 251);
  bytes.writeUInt32BE(i, 0);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

function shot(): ParsedPromptEntry {
  return parsePromptsFromRawText('S01 | SH01 | a boat at dawn', 'image')[0];
}

/** Fresh, empty IndexedDB for every test (also simulates a different browser profile). */
async function wipeDb() {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  _resetMediaCachesForTests();
}

describe('version logic (pure)', () => {
  it('keeps every version: 30 outputs => 30 versions, none dropped (the old cap was 8)', () => {
    let item = shot();
    for (let i = 1; i <= 30; i++) item = addVersion(item, fakeImage(i), 'cloud_generated');
    assert.equal(item.candidates!.length, 30);
    assert.equal(item.candidates![0].url, fakeImage(1), 'the very first version is still there');
    assert.equal(item.generatedUrl, fakeImage(30));
    assert.equal(item.selectedCandidateId, item.candidates![29].id);
    assert.equal(item.status, 'completed');
  });

  it('a new version does not change older versions; old versions can be selected again', () => {
    let item = shot();
    for (let i = 1; i <= 3; i++) item = addVersion(item, fakeImage(i), 'cloud_generated');
    const first = item.candidates![0];
    item = selectVersion(item, first.id);
    assert.equal(item.generatedUrl, fakeImage(1));
    item = addVersion(item, fakeImage(4), 'uploaded', 'mine.png');
    assert.equal(item.candidates!.length, 4);
    assert.equal(item.candidates![0].id, first.id);
    assert.equal(item.candidates![3].source, 'uploaded');
    assert.equal(versionNumber(item, first.id), 1);
  });

  it('removal happens only through removeVersion (explicit) and falls back to the newest remaining', () => {
    let item = shot();
    for (let i = 1; i <= 3; i++) item = addVersion(item, fakeImage(i), 'cloud_generated');
    const [v1, v2, v3] = item.candidates!;
    item = removeVersion(item, v3.id);
    assert.equal(item.candidates!.length, 2);
    assert.equal(item.selectedCandidateId, v2.id);
    item = removeVersion(removeVersion(item, v2.id), v1.id);
    assert.equal(item.candidates!.length, 0);
    assert.equal(item.generatedUrl, undefined);
    assert.equal(item.status, 'waiting');
  });
});

describe('separate media storage (IndexedDB)', () => {
  beforeEach(wipeDb);

  it('moves big media out of the project JSON, de-duplicates it, and brings it back identically', async () => {
    const db = await openStudioDb();
    const state = { items: [fakeImage(1), fakeImage(2), fakeImage(1)], tiny: 'data:image/png;base64,AAAA' };
    const { persisted, stored } = await externalizeMedia(db, state);
    assert.equal(stored, 2, 'identical content is stored once');
    assert.ok(persisted.items.every((u) => u.startsWith('idb://')));
    assert.equal(persisted.items[0], persisted.items[2]);
    assert.equal(persisted.tiny, state.tiny, 'tiny strings stay inline');
    assert.ok(JSON.stringify(persisted).length < 400, 'project record only holds small references');

    _resetMediaCachesForTests(); // like a page reload
    const { state: back, missing } = await rehydrateMedia(db, persisted);
    assert.deepEqual(missing, []);
    assert.ok(back.items[0].startsWith('blob:'));
    assert.equal(back.items[0], back.items[2]);
    const blob = await (await import('node:buffer')).resolveObjectURL(back.items[1])!;
    const original = Buffer.from(fakeImage(2).split(',')[1], 'base64');
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), original, 'bytes are identical after reload');
  });

  it('reload keeps ALL versions: save 20 versions of 2 shots, reload, every version is back', async () => {
    const proj: MovieProject = createBlankProject('Versions');
    let a = shot();
    let b = parsePromptsFromRawText('S01 | SH02 | second', 'image')[0];
    for (let i = 1; i <= 20; i++) a = addVersion(a, fakeImage(i), 'cloud_generated');
    for (let i = 101; i <= 110; i++) b = addVersion(b, fakeImage(i), 'cloud_generated');
    proj.imagePrompts = { ...proj.imagePrompts, parsedItems: [a, b] };

    const status = await saveStudioState({ activeProjectId: proj.id, projects: [proj], cloudSettings: { backendUrl: '', gcpProjectId: '', gcpRegion: '', gcsBucket: '', status: 'not_configured' }, savedAt: 'now' });
    assert.equal(status.ok, true, JSON.stringify(status));

    _resetMediaCachesForTests();
    const loaded = await loadStudioState();
    assert.equal(loaded.missingMedia, 0);
    const items = loaded.state!.projects[0].imagePrompts.parsedItems;
    assert.equal(items[0].candidates!.length, 20);
    assert.equal(items[1].candidates!.length, 10);
    assert.ok(items[0].candidates!.every((c) => c.url.startsWith('blob:')));
    assert.equal(items[0].generatedUrl, items[0].candidates![19].url, 'selected version still matches its entry');
    assert.deepEqual(items[0].candidates!.map((c) => c.createdAt), a.candidates!.map((c) => c.createdAt), 'metadata kept');
    const countReq = (await openStudioDb()).transaction(MEDIA_STORE).objectStore(MEDIA_STORE).count();
    const stored = await new Promise<number>((resolve) => {
      countReq.onsuccess = () => resolve(countReq.result);
    });
    assert.equal(stored, 30, '20 + 10 distinct files stored separately from the project record');
  });

  it('removing a version never deletes files by itself; cleanup removes only unused files after the user asks', async () => {
    const db = await openStudioDb();
    let item = shot();
    for (let i = 1; i <= 3; i++) item = addVersion(item, fakeImage(i), 'cloud_generated');
    const state = { p: [item] };
    await externalizeMedia(db, state);
    assert.deepEqual(await mediaReport(db, state), { count: 3, bytes: 27000, unusedCount: 0, unusedBytes: 0 });

    const afterRemove = { p: [removeVersion(item, item.candidates![1].id)] };
    await externalizeMedia(db, afterRemove);
    const r = await mediaReport(db, afterRemove);
    assert.equal(r.count, 3, 'file is still stored after the version was removed from the project');
    assert.equal(r.unusedCount, 1);

    const cleaned = await cleanUnusedMedia(db, afterRemove);
    assert.equal(cleaned.deleted, 1);
    assert.equal((await mediaReport(db, afterRemove)).count, 2);
    // the remaining versions are untouched
    _resetMediaCachesForTests();
    const { missing } = await rehydrateMedia(db, (await externalizeMedia(db, afterRemove)).persisted);
    assert.deepEqual(missing, []);
  });

  it('a missing file is reported, never silently ignored', async () => {
    const db = await openStudioDb();
    const { missing } = await rehydrateMedia(db, { u: 'idb://does-not-exist' });
    assert.deepEqual(missing, ['does-not-exist']);
  });

  it('formatBytes is human readable', () => {
    assert.equal(formatBytes(2048), '2 KB');
    assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
  });
});
