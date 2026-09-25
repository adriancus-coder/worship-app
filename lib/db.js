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
    db.transaction(() => {
      db.exec(sql);
      record.run(name, Date.now());
    })();
    applied.push(name);
  }

  return applied;
}

module.exports = { openDb, runMigrations };
