// ইউনিট টেস্ট: S3 সই (AWS-এর নিজের উদাহরণ), ZIP, SQL রূপান্তর, ডেটাবেসের কাজ-নেওয়া/রেট-লিমিট/লক।
// চালাও: npm run test:unit   (PostgreSQL-এও চালাতে: TEST_DATABASE_URL=postgres://... npm run test:unit)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { signRequest, presignUrl, sha256 } = require('../lib/sigv4');
const { createZip, crc32 } = require('../lib/zip');
const { openDb, toPg } = require('../lib/db');

test('SigV4: AWS-এর IAM ListUsers উদাহরণ', () => {
  const { signature } = signRequest({
    method: 'GET', url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
    payloadHash: sha256(''), region: 'us-east-1', service: 'iam',
    accessKey: 'AKIDEXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', date: new Date('2015-08-30T12:36:00Z'),
  });
  assert.equal(signature, '5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7');
});

test('SigV4: AWS-এর S3 GET Object (Range) উদাহরণ', () => {
  const { signature } = signRequest({
    method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', headers: { Range: 'bytes=0-9' },
    payloadHash: sha256(''), region: 'us-east-1', service: 's3',
    accessKey: 'AKIAIOSFODNN7EXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', date: new Date('2013-05-24T00:00:00Z'),
  });
  assert.equal(signature, 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
});

test('SigV4: AWS-এর S3 presigned URL উদাহরণ', () => {
  const url = presignUrl({
    url: 'https://examplebucket.s3.amazonaws.com/test.txt', region: 'us-east-1', expires: 86400,
    accessKey: 'AKIAIOSFODNN7EXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', date: new Date('2013-05-24T00:00:00Z'),
  });
  assert.match(url, /X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/);
});

test('ZIP: unzip দিয়ে খোলা যায়, CRC ঠিক', async () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926); // CRC-32 এর মানক যাচাই-মান
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-zip-'));
  const file = path.join(dir, 'a.zip');
  const chunks = [];
  const z = createZip(async b => { chunks.push(b); });
  await z.add('project.json', Buffer.from('{"নাম":"নদী"}'));
  await z.add('media/ছবি-১.bin', Buffer.alloc(100000, 7));
  await z.finish();
  fs.writeFileSync(file, Buffer.concat(chunks));
  const py = 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(sorted(z.namelist())); print(z.read("project.json").decode())';
  const outp = execFileSync('python3', ['-I', '-c', py, file]).toString();
  assert.match(outp, /media\/ছবি-১\.bin/);
  assert.match(outp, /"নাম":"নদী"/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('SQL: ? থেকে $n (উদ্ধৃতির ভেতর বাদ)', () => {
  assert.equal(toPg("SELECT * FROM t WHERE a=? AND b='x?y' AND c=?"), "SELECT * FROM t WHERE a=$1 AND b='x?y' AND c=$2");
});

async function dbSuite(name, open) {
  test(`ডেটাবেস (${name}): কাজ-নেওয়া, প্রতি ব্যবহারকারী সীমা, রেট লিমিট, লক, ট্রানজ্যাকশন`, async () => {
    const db = await open();
    try {
      await db.run('DELETE FROM jobs');
      const t = Date.now();
      for (let i = 0; i < 5; i++) {
        await db.run("INSERT INTO jobs(id,uid,project_id,kind,status,request,created,updated) VALUES(?,?,?,?,'queued','{}',?,?)",
          'j' + i, i < 3 ? 'u1' : 'u2', 'p', 'image', t + i, t + i);
      }
      // দুজন "কর্মী" একসাথে কাজ নিলে কোনো কাজ দুবার যায় না, আর u1 একসাথে ২টার বেশি পায় না
      const claims = await Promise.all(Array.from({ length: 8 }, (_, i) => db.claimJob('w' + (i % 2), 2, 60000)));
      const got = claims.filter(Boolean);
      assert.equal(new Set(got).size, got.length, 'একই কাজ দুবার নেওয়া হয়েছে');
      const running = await db.all("SELECT uid, COUNT(*) AS n FROM jobs WHERE status='running' GROUP BY uid ORDER BY uid");
      const byUid = Object.fromEntries(running.map(r => [r.uid, Number(r.n)]));
      assert.ok(byUid.u1 <= 2, 'u1 সীমার বেশি কাজ পেয়েছে');
      assert.equal(byUid.u2, 2);
      // রেট লিমিট
      await db.run('DELETE FROM rate_limits');
      const hits = [];
      for (let i = 0; i < 5; i++) hits.push(await db.hit('test:k', 60000));
      assert.deepEqual(hits, [1, 2, 3, 4, 5]);
      // লক
      await db.run('DELETE FROM locks');
      assert.equal(await db.lock('L', 60000), true);
      assert.equal(await db.lock('L', 60000), false);
      await db.unlock('L');
      assert.equal(await db.lock('L', 60000), true);
      // ট্রানজ্যাকশন বাতিল হলে কিছু থাকে না
      await assert.rejects(db.tx(async q => {
        await q.run("INSERT INTO settings(key, value) VALUES('tx-test','1')");
        throw new Error('বাতিল');
      }));
      assert.equal(await db.get("SELECT value FROM settings WHERE key='tx-test'"), undefined);
      // সেটিং একবারই বানানো হয়
      const a = await db.setting('secret-test', () => 'first');
      const b = await db.setting('secret-test', () => 'second');
      assert.equal(a, 'first');
      assert.equal(b, 'first');
    } finally {
      await db.close();
    }
  });
}

dbSuite('SQLite', () => openDb({ sqliteFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cp-db-')), 't.db') }));
if (process.env.TEST_DATABASE_URL) {
  dbSuite('PostgreSQL', async () => {
    const db = await openDb({ url: process.env.TEST_DATABASE_URL });
    await db.run("DELETE FROM settings WHERE key IN ('secret-test','tx-test')");
    return db;
  });
}
