/**
 * Deployment guard tests. A FAKE `gcloud` on PATH records every call and does nothing else
 * (no real Google Cloud command can run). Invalid configuration must stop the script before
 * the first gcloud call, with a clear message.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import { buildOptionsFromEnv, ConfigError } from '../server/config';
import { parseAllowedEmails, validateDeployConfig, validateOAuthClientId } from '../server/shared/config-rules.mjs';
import { tempDir } from './helpers';

const ROOT = path.resolve('.');
const SCRIPT = path.join(ROOT, 'deploy/deploy-cloudrun.sh');
const VALID = {
  PROJECT_ID: 'my-movie-studio-123',
  OAUTH_CLIENT_ID: '123456789012-abcdefghij0123456789.apps.googleusercontent.com',
  ALLOWED_EMAILS: 'me@gmail.com,friend@gmail.com',
};

let fakeBin = '';
let logFile = '';
before(() => {
  const dir = tempDir('fakegcloud-');
  fakeBin = path.join(dir, 'bin');
  logFile = path.join(dir, 'gcloud-calls.log');
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(path.join(fakeBin, 'gcloud'), `#!/usr/bin/env bash\necho "gcloud $*" >> "${logFile}"\nexit 0\n`, { mode: 0o755 });
});

function runScript(env: Record<string, string | undefined>, input = 'NO\n') {
  fs.rmSync(logFile, { force: true });
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined) clean[k] = v;
  const r = spawnSync('bash', [SCRIPT], {
    env: { PATH: `${fakeBin}:${process.env.PATH}`, HOME: process.env.HOME || '/tmp', ...clean },
    input,
    encoding: 'utf8',
    cwd: ROOT,
    timeout: 30_000,
  });
  const calls = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean) : [];
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, calls };
}

describe('ALLOWED_EMAILS rules (shared by backend and deploy script)', () => {
  const bad: Array<[string, string | undefined]> = [
    ['undefined', undefined],
    ['empty string', ''],
    ['only spaces', '   '],
    ['only a comma', ','],
    ['commas and spaces', ' , ,, , '],
    ['only commas', ',,,'],
    ['no @', 'notanemail'],
    ['no domain dot', 'me@localhost'],
    ['one valid + one invalid', 'me@gmail.com,bad'],
    ['space instead of comma', 'me@gmail.com friend@gmail.com'],
    ['empty local part', '@gmail.com'],
    ['dot-leading domain', 'me@.com'],
    ['double dot domain', 'me@x..com'],
    ['angle brackets', '<me@gmail.com>'],
  ];
  for (const [name, value] of bad) {
    it(`rejects: ${name}`, () => {
      const r = parseAllowedEmails(value);
      assert.deepEqual(r.emails, []);
      assert.ok(r.errors.length > 0 && r.errors.every((e) => e.includes('ALLOWED_EMAILS')), r.errors.join('|'));
    });
  }
  it('trims whitespace, lower-cases, removes duplicates and empty entries', () => {
    assert.deepEqual(parseAllowedEmails('  Me@Gmail.COM ,, friend@Y.org , me@gmail.com ,').emails, ['me@gmail.com', 'friend@y.org']);
  });
  it('OAuth client id must look like a Google client id', () => {
    assert.equal(validateOAuthClientId(VALID.OAUTH_CLIENT_ID).length, 0);
    for (const bad of ['', '  ', 'abc', 'x.apps.google.com', 'a b.apps.googleusercontent.com']) assert.ok(validateOAuthClientId(bad).length > 0, bad);
  });
  it('the backend refuses exactly the same values with the same message', () => {
    const base = { GOOGLE_OAUTH_CLIENT_ID: VALID.OAUTH_CLIENT_ID, SESSION_SECRET: 'z'.repeat(40) };
    for (const [name, value] of bad) {
      let message = '';
      try {
        buildOptionsFromEnv({ ...base, ...(value === undefined ? {} : { ALLOWED_EMAILS: value }) });
      } catch (e) {
        assert.ok(e instanceof ConfigError, name);
        message = (e as Error).message;
      }
      assert.ok(message, `backend must refuse: ${name}`);
      assert.ok(message.includes(parseAllowedEmails(value).errors[0]), `same wording as the script for: ${name}`);
    }
    // and accepts the valid list in normalized form
    const ok = buildOptionsFromEnv({ ...base, ALLOWED_EMAILS: ' Me@Gmail.com , friend@gmail.com,' });
    assert.deepEqual(ok.auth.mode === 'google' && ok.auth.allowedEmails, ['me@gmail.com', 'friend@gmail.com']);
  });
});

describe('deploy script', () => {
  it('has valid bash syntax', () => {
    const r = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });

  it('control: with a valid configuration and YES it does call gcloud (the fake works), with cleaned-up emails', () => {
    const r = runScript({ ...VALID, ALLOWED_EMAILS: ' Me@Gmail.com , friend@gmail.com ,' }, 'YES\n\n');
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(r.calls.length > 5, 'gcloud was called after the confirmation');
    assert.ok(r.calls.some((c) => c.includes('ALLOWED_EMAILS=me@gmail.com,friend@gmail.com;')), 'normalized list is what gets deployed');
    assert.ok(!r.calls.some((c) => /ALLOWED_EMAILS=[^;]* /.test(c)), 'no stray spaces');
    assert.ok(r.calls.some((c) => c.includes('--max-instances 3')), 'default instance limit is passed');
    assert.ok(r.calls.some((c) => c.includes('firestore fields ttls update expiresAt --collection-group=jobs')), 'TTL policy for old jobs');
  });

  it('valid configuration but the answer is not YES: nothing is run', () => {
    const r = runScript({ ...VALID }, 'no\n');
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /Cancelled/);
    assert.deepEqual(r.calls, [], 'no gcloud command before the confirmation');
    assert.match(r.stdout, /Allowed: me@gmail.com,friend@gmail.com/);
  });

  const invalidEmails: Array<[string, string | undefined]> = [
    ['missing', undefined],
    ['empty', ''],
    ['spaces only', '   '],
    ['comma only', ','],
    ['commas and spaces', ' , ,, '],
    ['invalid address', 'me@gmail.com,oops'],
    ['space-separated', 'a@b.com c@d.com'],
  ];
  for (const [name, value] of invalidEmails) {
    it(`ALLOWED_EMAILS ${name}: stops with a clear error and runs NO gcloud command`, () => {
      const r = runScript({ ...VALID, ALLOWED_EMAILS: value }, 'YES\n\n');
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /ALLOWED_EMAILS/);
      assert.match(r.stderr, /Nothing was changed in Google Cloud/);
      assert.deepEqual(r.calls, [], `gcloud must not be called, got: ${r.calls.join(' | ')}`);
    });
  }

  const invalidOthers: Array<[string, Record<string, string | undefined>, RegExp]> = [
    ['missing PROJECT_ID', { PROJECT_ID: undefined }, /PROJECT_ID/],
    ['bad PROJECT_ID', { PROJECT_ID: 'Bad_Project' }, /PROJECT_ID/],
    ['missing OAUTH_CLIENT_ID', { OAUTH_CLIENT_ID: undefined }, /OAUTH_CLIENT_ID/],
    ['bad OAUTH_CLIENT_ID', { OAUTH_CLIENT_ID: 'not-a-client-id' }, /OAUTH_CLIENT_ID/],
    ['bad REGION', { REGION: 'mars' }, /REGION/],
    ['bad BUCKET', { BUCKET: 'Bad Bucket!' }, /BUCKET/],
    ['bad SERVICE', { SERVICE: 'Bad_Service' }, /SERVICE/],
    ['bad SIGNED_URLS', { SIGNED_URLS: 'maybe' }, /SIGNED_URLS/],
    ['bad MAX_INSTANCES (0)', { MAX_INSTANCES: '0' }, /MAX_INSTANCES/],
    ['bad MAX_INSTANCES (text)', { MAX_INSTANCES: 'many' }, /MAX_INSTANCES/],
    ['bad MAX_INSTANCES (too many)', { MAX_INSTANCES: '99' }, /MAX_INSTANCES/],
  ];
  for (const [name, override, re] of invalidOthers) {
    it(`${name}: stops before any gcloud command`, () => {
      const r = runScript({ ...VALID, ...override }, 'YES\n\n');
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, re);
      assert.deepEqual(r.calls, []);
    });
  }

  it('reports ALL problems at once, not only the first', () => {
    const r = runScript({ PROJECT_ID: 'x', OAUTH_CLIENT_ID: 'bad', ALLOWED_EMAILS: ',' }, 'YES\n');
    assert.notEqual(r.status, 0);
    for (const word of ['PROJECT_ID', 'OAUTH_CLIENT_ID', 'ALLOWED_EMAILS']) assert.match(r.stderr, new RegExp(word));
    assert.deepEqual(r.calls, []);
  });

  it('validateDeployConfig returns normalized values', () => {
    const v = validateDeployConfig({ ...VALID, REGION: ' us-central1 ' });
    assert.deepEqual(v.errors, []);
    assert.equal(v.values.region, 'us-central1');
    assert.equal(v.values.bucket, 'my-movie-studio-123-movie-studio-media');
  });
});
