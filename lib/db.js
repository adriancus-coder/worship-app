'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'worship.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

// Applies lib/migrations/*.sql in filename order, each in its own transaction.
// A migration that rebuilds a table (to change a CHECK constraint) starts with the line
// "-- migrate: foreign_keys off": it runs with foreign keys off (otherwise dropping the old
// table would fire ON DELETE actions in other tables), and must leave no broken reference
// (PRAGMA foreign_key_check) or it is rolled back.
// Returns the names of the migrations applied by this call.
function runMigrations(db, dir = MIGRATIONS_DIR) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);

  const done = new Set(db.prepare('SELECT name FROM schema_migrations').pluck().all());
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const record = db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)');
  const applied = [];

  for (const name of files) {
    if (done.has(name)) continue;
    const sql = fs.readFileSync(path.join(dir, name), 'utf8');
    const rebuild = /^-- migrate: foreign_keys off$/m.test(sql);
    const before = db.pragma('foreign_keys', { simple: true });
    if (rebuild) db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        db.exec(sql);
        if (rebuild && db.pragma('foreign_key_check').length) throw new Error(`${name}: broken foreign keys`);
        record.run(name, Date.now());
      })();
    } finally {
      if (rebuild) db.pragma(`foreign_keys = ${before ? 'ON' : 'OFF'}`);
    }
    applied.push(name);
  }

  return applied;
}

module.exports = { openDb, runMigrations };
