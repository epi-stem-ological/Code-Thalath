'use strict';

/**
 * Takes a consistent copy of the live database.
 *
 * Run inside the container, where /data is the mounted volume:
 *   node /app/scripts/snapshot.js /data/_snapshot.db
 *
 * Copying thalath.db with cp or tar while the app is running can catch it
 * mid-write: the database runs in WAL mode, so the main file alone may be an
 * incomplete picture. VACUUM INTO asks SQLite itself to write a complete,
 * self-contained copy, safe to take while the app keeps serving.
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const target = process.argv[2];
if (!target) {
  console.error('usage: node snapshot.js <target.db>');
  process.exit(2);
}

const dataDir = process.env.DATA_DIR || '/data/db';
const source = path.join(dataDir, 'thalath.db');

if (!fs.existsSync(source)) {
  console.error(`no database at ${source}`);
  process.exit(1);
}

fs.rmSync(target, { force: true });

const db = new Database(source, { readonly: true, fileMustExist: true });
try {
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
} finally {
  db.close();
}

const bytes = fs.statSync(target).size;
const check = new Database(target, { readonly: true });
const tables = check.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table'").get().c;
const users = check.prepare('SELECT COUNT(*) c FROM users').get().c;
const integrity = check.pragma('integrity_check', { simple: true });
check.close();

console.log(`snapshot: ${target}`);
console.log(`  bytes:     ${bytes}`);
console.log(`  tables:    ${tables}`);
console.log(`  members:   ${users}`);
console.log(`  integrity: ${integrity}`);
if (integrity !== 'ok') process.exit(1);
