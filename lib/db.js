// ডেটাবেস লেয়ার: একই কোড SQLite (একটা সার্ভার) আর PostgreSQL (অনেক সার্ভার) দুটোতেই চলে।
// সব ফাংশন async। SQL-এ `?` প্লেসহোল্ডার লেখা হয়, PostgreSQL-এর জন্য নিজে থেকে $1, $2... হয়ে যায়।
'use strict';

// দুই ডেটাবেসেই চলে এমন স্কিমা। সময় (ms) BIGINT, কারণ PostgreSQL-এর INTEGER ৩২-বিট।
const TABLES = [
  `CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, picture TEXT,
    created BIGINT, last BIGINT, sv INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS allowed(email TEXT PRIMARY KEY, added BIGINT)`,
  `CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS folders(id TEXT PRIMARY KEY, uid TEXT NOT NULL, name TEXT NOT NULL, created BIGINT)`,
  `CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, uid TEXT NOT NULL, folder_id TEXT, name TEXT NOT NULL,
    created BIGINT, updated BIGINT, clips TEXT NOT NULL DEFAULT '[]', story TEXT NOT NULL DEFAULT '{}')`,
  `CREATE TABLE IF NOT EXISTS characters(id TEXT PRIMARY KEY, uid TEXT NOT NULL, project_id TEXT NOT NULL, name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '', created BIGINT)`,
  `CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, uid TEXT NOT NULL, project_id TEXT NOT NULL, character_id TEXT,
    kind TEXT NOT NULL, mime TEXT NOT NULL, file TEXT NOT NULL, prompt TEXT, mode TEXT, meta TEXT NOT NULL DEFAULT '{}',
    interaction_id TEXT, parent_id TEXT, favorite INTEGER NOT NULL DEFAULT 0, created BIGINT)`,
  `CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, uid TEXT NOT NULL, project_id TEXT NOT NULL, kind TEXT NOT NULL,
    status TEXT NOT NULL, label TEXT, request TEXT NOT NULL, interaction_id TEXT, error TEXT, asset_id TEXT,
    created BIGINT, updated BIGINT)`,
  `CREATE TABLE IF NOT EXISTS collections(id TEXT PRIMARY KEY, uid TEXT NOT NULL, project_id TEXT NOT NULL, name TEXT NOT NULL, created BIGINT)`,
  `CREATE TABLE IF NOT EXISTS collection_items(collection_id TEXT NOT NULL, asset_id TEXT NOT NULL, PRIMARY KEY(collection_id, asset_id))`,
  `CREATE TABLE IF NOT EXISTS chat(id TEXT PRIMARY KEY, uid TEXT NOT NULL, project_id TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, created BIGINT)`,
  `CREATE TABLE IF NOT EXISTS activity(id TEXT PRIMARY KEY, uid TEXT, action TEXT NOT NULL, target TEXT, detail TEXT, created BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY, win BIGINT NOT NULL, count INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS locks(key TEXT PRIMARY KEY, until BIGINT NOT NULL)`,
  // ডকুমেন্টারি স্টুডিও (আলাদা মডিউল, অন্য কিছুর সাথে ভাগ হয় না)
  `CREATE TABLE IF NOT EXISTS doc_projects(id TEXT PRIMARY KEY, uid TEXT NOT NULL, name TEXT NOT NULL, budget_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    spent_usd DOUBLE PRECISION NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT '{}', busy_until BIGINT, created BIGINT, updated BIGINT)`,
  `CREATE TABLE IF NOT EXISTS doc_messages(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, uid TEXT NOT NULL, seq INTEGER NOT NULL, role TEXT NOT NULL,
    parts TEXT NOT NULL DEFAULT '[]', display TEXT NOT NULL DEFAULT '', meta TEXT NOT NULL DEFAULT '{}', created BIGINT)`,
  `CREATE TABLE IF NOT EXISTS doc_files(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, uid TEXT NOT NULL, path TEXT NOT NULL, mime TEXT NOT NULL,
    kind TEXT NOT NULL, file TEXT NOT NULL, size BIGINT NOT NULL DEFAULT 0, source TEXT NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'ready',
    interaction_id TEXT, cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0, announced INTEGER NOT NULL DEFAULT 0, created BIGINT, updated BIGINT)`,
  // অভিযোগ ও সাহায্য
  `CREATE TABLE IF NOT EXISTS complaints(id TEXT PRIMARY KEY, uid TEXT NOT NULL, category TEXT NOT NULL, subject TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open', created BIGINT, updated BIGINT, last_by TEXT)`,
  `CREATE TABLE IF NOT EXISTS complaint_msgs(id TEXT PRIMARY KEY, complaint_id TEXT NOT NULL, uid TEXT NOT NULL, by_staff INTEGER NOT NULL DEFAULT 0,
    text TEXT NOT NULL, created BIGINT)`,
  `CREATE TABLE IF NOT EXISTS doc_settings(uid TEXT PRIMARY KEY, system TEXT NOT NULL DEFAULT '', lessons TEXT NOT NULL DEFAULT '', updated BIGINT)`,
];

// পরে যোগ হওয়া কলাম: পুরনো ডেটাবেসে নিরাপদে যোগ হয়, কিছু মোছে না
const COLUMNS = {
  users: [['sv', 'INTEGER NOT NULL DEFAULT 0'], ['display_name', 'TEXT'], ['photo', 'TEXT'], ['photo_v', 'BIGINT'],
    ['role', "TEXT NOT NULL DEFAULT 'user'"], ['blocked', 'INTEGER NOT NULL DEFAULT 0'], ['block_reason', 'TEXT']],
  assets: [['title', 'TEXT'], ['deleted_at', 'BIGINT'], ['size', 'BIGINT NOT NULL DEFAULT 0']],
  characters: [['voice', 'TEXT'], ['info', 'TEXT']],
  jobs: [['worker', 'TEXT'], ['lease_until', 'BIGINT'], ['attempts', 'INTEGER NOT NULL DEFAULT 0'],
    ['started', 'BIGINT'], ['finished', 'BIGINT'], ['cost_usd', 'DOUBLE PRECISION NOT NULL DEFAULT 0']],
};

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS i_projects_uid ON projects(uid, updated)',
  'CREATE INDEX IF NOT EXISTS i_chars_project ON characters(project_id)',
  'CREATE INDEX IF NOT EXISTS i_assets_project ON assets(project_id, deleted_at, created)',
  'CREATE INDEX IF NOT EXISTS i_assets_char ON assets(character_id)',
  'CREATE INDEX IF NOT EXISTS i_assets_uid ON assets(uid)',
  'CREATE INDEX IF NOT EXISTS i_assets_parent ON assets(parent_id)',
  'CREATE INDEX IF NOT EXISTS i_jobs_project ON jobs(project_id, created)',
  'CREATE INDEX IF NOT EXISTS i_jobs_status ON jobs(status, created)',
  'CREATE INDEX IF NOT EXISTS i_jobs_uid ON jobs(uid, created)',
  'CREATE INDEX IF NOT EXISTS i_coll_project ON collections(project_id)',
  'CREATE INDEX IF NOT EXISTS i_coll_items_asset ON collection_items(asset_id)',
  'CREATE INDEX IF NOT EXISTS i_chat_project ON chat(project_id, created)',
  'CREATE INDEX IF NOT EXISTS i_activity_created ON activity(created)',
  'CREATE INDEX IF NOT EXISTS i_activity_uid ON activity(uid, created)',
  'CREATE INDEX IF NOT EXISTS i_doc_projects_uid ON doc_projects(uid, updated)',
  'CREATE INDEX IF NOT EXISTS i_complaints_uid ON complaints(uid, updated)',
  'CREATE INDEX IF NOT EXISTS i_complaints_status ON complaints(status, updated)',
  'CREATE INDEX IF NOT EXISTS i_complaint_msgs ON complaint_msgs(complaint_id, created)',
  'CREATE UNIQUE INDEX IF NOT EXISTS i_doc_messages_seq ON doc_messages(project_id, seq)',
  'CREATE INDEX IF NOT EXISTS i_doc_files_project ON doc_files(project_id, path)',
  'CREATE INDEX IF NOT EXISTS i_doc_files_pending ON doc_files(status, updated)',
  'CREATE INDEX IF NOT EXISTS i_doc_files_uid ON doc_files(uid, created)',
];

// SQL-এর `?` কে PostgreSQL-এর $1, $2... তে বদলায় (উদ্ধৃতির ভেতরের ? ছোঁয় না)
function toPg(sql) {
  let n = 0;
  let out = '';
  let quote = null;
  for (const ch of sql) {
    if (quote) { if (ch === quote) quote = null; out += ch; continue; }
    if (ch === "'" || ch === '"') { quote = ch; out += ch; continue; }
    out += ch === '?' ? '$' + ++n : ch;
  }
  return out;
}

/* ---------------- SQLite ---------------- */
function openSqlite(file) {
  const { DatabaseSync } = require('node:sqlite');
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=OFF;');
  const stmts = new Map();
  const prep = sql => {
    let s = stmts.get(sql);
    if (!s) { s = raw.prepare(sql); stmts.set(sql, s); }
    return s;
  };
  // ট্রানজ্যাকশন চলার সময় অন্য অনুরোধ অপেক্ষা করে, যাতে একই কানেকশনে মিশে না যায়
  let txTail = Promise.resolve();
  let txOpen = false;
  const ops = {
    async get(sql, ...a) { return prep(sql).get(...a); },
    async all(sql, ...a) { return prep(sql).all(...a); },
    async run(sql, ...a) { const r = prep(sql).run(...a); return { changes: Number(r.changes) }; },
  };
  const guarded = {};
  for (const k of Object.keys(ops)) {
    guarded[k] = async (...args) => { while (txOpen) await txTail; return ops[k](...args); };
  }
  return {
    kind: 'sqlite',
    ...guarded,
    async exec(sql) { raw.exec(sql); },
    async tx(fn) {
      const prev = txTail;
      let release;
      txTail = new Promise(r => (release = r));
      await prev;
      txOpen = true;
      raw.exec('BEGIN IMMEDIATE');
      try {
        const out = await fn(ops);
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        try { raw.exec('ROLLBACK'); } catch { /* আগেই বাতিল */ }
        throw e;
      } finally {
        txOpen = false;
        release();
      }
    },
    async columns(table) { return raw.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name); },
    async ping() { raw.prepare('SELECT 1').get(); return true; },
    async close() { raw.close(); },
  };
}

/* ---------------- PostgreSQL ---------------- */
function openPostgres(url, poolSize) {
  let pg;
  try { pg = require('pg'); } catch {
    throw new Error('DATABASE_URL দেওয়া আছে কিন্তু "pg" প্যাকেজ নেই। chitropot ফোল্ডারে `npm install pg` চালাও।');
  }
  pg.types.setTypeParser(20, v => (v === null ? null : Number(v)));   // BIGINT / COUNT(*) → সংখ্যা
  pg.types.setTypeParser(1700, v => (v === null ? null : Number(v))); // NUMERIC → সংখ্যা
  const ssl = /sslmode=(require|verify)/.test(url) ? { rejectUnauthorized: /verify-full/.test(url) } : undefined;
  const pool = new pg.Pool({ connectionString: url, max: poolSize, ssl, idleTimeoutMillis: 30000 });
  const mk = c => ({
    async get(sql, ...a) { return (await c.query(toPg(sql), a)).rows[0]; },
    async all(sql, ...a) { return (await c.query(toPg(sql), a)).rows; },
    async run(sql, ...a) { const r = await c.query(toPg(sql), a); return { changes: r.rowCount }; },
  });
  return {
    kind: 'pg',
    ...mk(pool),
    async exec(sql) { await pool.query(sql); },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(mk(client));
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    async columns(table) {
      return (await pool.query('SELECT column_name FROM information_schema.columns WHERE table_name=$1', [table])).rows.map(r => r.column_name);
    },
    async ping() { await pool.query('SELECT 1'); return true; },
    async close() { await pool.end(); },
  };
}

/* ---------------- খোলা ও মাইগ্রেশন ---------------- */
async function openDb({ url, sqliteFile, poolSize = 10 }) {
  const db = url ? openPostgres(url, poolSize) : openSqlite(sqliteFile);
  for (const t of TABLES) await db.exec(t);
  for (const [table, cols] of Object.entries(COLUMNS)) {
    const have = new Set(await db.columns(table));
    for (const [col, def] of cols) {
      if (!have.has(col)) await db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    }
  }
  for (const i of INDEXES) await db.exec(i);

  // কাজ নেওয়া: একাধিক সার্ভার থাকলেও একটা কাজ একজনই পায়
  db.claimJob = async (worker, maxRunning, leaseMs) => {
    const t = Date.now();
    if (db.kind === 'pg') {
      const r = await db.get(`UPDATE jobs SET status='running', worker=?, lease_until=?, started=COALESCE(started, ?), attempts=attempts+1, updated=?
        WHERE id = (SELECT j.id FROM jobs j WHERE j.status='queued'
          AND (SELECT COUNT(*) FROM jobs r WHERE r.uid=j.uid AND r.status='running') < ?
          ORDER BY j.created LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id`, worker, t + leaseMs, t, t, maxRunning);
      return r ? r.id : null;
    }
    return db.tx(async q => {
      const list = await q.all("SELECT id, uid FROM jobs WHERE status='queued' ORDER BY created LIMIT 100");
      for (const j of list) {
        const n = (await q.get("SELECT COUNT(*) AS n FROM jobs WHERE uid=? AND status='running'", j.uid)).n;
        if (n >= maxRunning) continue;
        const r = await q.run(`UPDATE jobs SET status='running', worker=?, lease_until=?, started=COALESCE(started, ?), attempts=attempts+1, updated=?
          WHERE id=? AND status='queued'`, worker, t + leaseMs, t, t, j.id);
        if (r.changes) return j.id;
      }
      return null;
    });
  };

  // রেট লিমিট: নির্দিষ্ট সময়ের জানালায় কতবার হলো (সব সার্ভার মিলিয়ে)
  db.hit = async (key, windowMs) => {
    const win = Math.floor(Date.now() / windowMs) * windowMs;
    const r = await db.get(`INSERT INTO rate_limits(key, win, count) VALUES(?, ?, 1)
      ON CONFLICT(key) DO UPDATE SET count = CASE WHEN rate_limits.win = excluded.win THEN rate_limits.count + 1 ELSE 1 END, win = excluded.win
      RETURNING count`, key, win);
    return Number(r.count);
  };

  // সময়সীমাসহ লক: একই প্রজেক্টে একসাথে দুটো এপিসোড/চ্যাট যাতে না চলে (সব সার্ভার মিলিয়ে)
  db.lock = async (key, ttlMs) => {
    const t = Date.now();
    const r = await db.get(`INSERT INTO locks(key, until) VALUES(?, ?)
      ON CONFLICT(key) DO UPDATE SET until = excluded.until WHERE locks.until < ?
      RETURNING key`, key, t + ttlMs, t);
    return Boolean(r);
  };
  db.unlock = key => db.run('DELETE FROM locks WHERE key=?', key);

  db.setting = async (key, make) => {
    const row = await db.get('SELECT value FROM settings WHERE key=?', key);
    if (row) return row.value;
    const value = make();
    await db.run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO NOTHING', key, value);
    return (await db.get('SELECT value FROM settings WHERE key=?', key)).value;
  };
  return db;
}

module.exports = { openDb, toPg };
