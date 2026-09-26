# Restoring a backup

A backup is the `.zip` the owner downloads from **Setări → Backup → Descarcă un backup
complet** (`GET /api/backup`). It is laid out like `DATA_DIR`:

```
meta.json                 app version, date, schema version, counts (for you; the app ignores it)
worship.db                the database, holding only this church (no sessions)
uploads/admin-<id>/...    uploaded files: media (videos, backgrounds) and the logo
```

There is no restore button: restoring replaces the data on the server, so it is done by
hand.

1. **Stop the service** (Render: suspend it, or scale to 0; locally: stop `node server.js`).
2. **Keep the current data** somewhere safe first: copy the whole `DATA_DIR` aside.
3. **Empty `DATA_DIR`**, removing `worship.db`, `worship.db-wal`, `worship.db-shm` and `uploads/`.
   Keep `media-secret` (it's only used to sign media links, so a new one would also work).
4. **Unzip the backup into `DATA_DIR`**, e.g. `unzip worship-backup-2026-09-26.zip -d "$DATA_DIR"`.
5. **Start the service.** On start it applies any newer migrations (`schema_migrations`),
   so a backup from an older version is brought up to date. A backup from a *newer*
   version than the running app is not supported.
6. Everyone signs in again: sessions are not part of a backup. Paired projector screens
   keep working.

Checks after a restore: `meta.json` counts match what the app shows (songs, events, team);
the media library shows its files.

Several churches on one server: a backup holds only the church that downloaded it.
Restoring it as above replaces the whole database, so on a shared server restore into a
separate `DATA_DIR` (a separate instance) instead.
