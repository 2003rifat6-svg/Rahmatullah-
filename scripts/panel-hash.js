// মালিকের কন্ট্রোল প্যানেলের পাসওয়ার্ডের হ্যাশ বানানো (সার্ভারে সাদা পাসওয়ার্ডের বদলে এটা রাখা নিরাপদ)।
// চালাও: npm run panel-hash      তারপর পাসওয়ার্ড লিখে Enter (লেখা পর্দায় দেখাবে না, কমান্ডের ইতিহাসেও থাকবে না)
// যা বের হবে সেটা সার্ভারের Variables-এ বসাও:  OWNER_PANEL_PASSWORD_HASH=scrypt$...$...
'use strict';
const { hashPanelPassword } = require('../lib/control');
const rl = require('node:readline').createInterface({ input: process.stdin, output: process.stdout, terminal: true });
rl._writeToOutput = s => { if (/পাসওয়ার্ড/.test(s)) process.stdout.write(s); };
rl.question('প্যানেলের পাসওয়ার্ড: ', pw => {
  rl.close();
  process.stdout.write('\n');
  if (!pw) { console.error('পাসওয়ার্ড খালি'); process.exit(1); }
  console.log('\nOWNER_PANEL_PASSWORD_HASH=' + hashPanelPassword(pw));
});
