// পরীক্ষার জন্য আলাদা খালি PostgreSQL ডেটাবেস বানানো ও শেষে মোছা।
// TEST_PG_ADMIN_URL দাও, যেমন postgres://postgres@127.0.0.1:5432/postgres
'use strict';
const crypto = require('node:crypto');

async function tempDatabase(adminUrl) {
  const { Client } = require('pg');
  const name = 'chitropot_t_' + crypto.randomBytes(4).toString('hex');
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const u = new URL(adminUrl);
  u.pathname = '/' + name;
  return {
    url: u.toString(),
    async drop() {
      const c = new Client({ connectionString: adminUrl });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}
module.exports = { tempDatabase };
