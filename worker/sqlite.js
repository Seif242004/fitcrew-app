// Makes a Durable Object's SQLite (ctx.storage.sql) look like node:sqlite's DatabaseSync, which
// is what the whole app is written against: db.prepare(sql).get/all/run and db.exec(sql).
// Both are synchronous, so the API code runs unchanged.
//
// Differences handled here:
//   - BEGIN / COMMIT / ROLLBACK: a Durable Object already commits each request's synchronous
//     writes atomically, and explicit transaction statements are not allowed, so they are no-ops.
//   - PRAGMA journal_mode / foreign_keys: managed by the platform; skipped.
//   - Bindings: undefined becomes null; Node Buffers become ArrayBuffers for BLOB columns.

const NOOP = /^\s*(BEGIN|COMMIT|ROLLBACK|END)\b|^\s*PRAGMA\s+(journal_mode|foreign_keys)\b/i;

const bind = (params) => params.map((v) => {
  if (v === undefined) return null;
  if (v instanceof Uint8Array) return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
});

export class DOSqlite {
  constructor(sql) { this.sql = sql; }

  exec(text) {
    // Split multi-statement scripts (the schema) and drop the statements the platform owns.
    const statements = text.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
    for (const s of statements) if (!NOOP.test(s)) this.sql.exec(s);
  }

  prepare(text) {
    const sql = this.sql;
    return {
      get: (...p) => sql.exec(text, ...bind(p)).toArray()[0],
      all: (...p) => sql.exec(text, ...bind(p)).toArray(),
      run: (...p) => {
        if (NOOP.test(text)) return { changes: 0, lastInsertRowid: 0 };
        const cur = sql.exec(text, ...bind(p));
        cur.toArray(); // run to completion
        const changes = cur.rowsWritten;
        const lastInsertRowid = sql.exec('SELECT last_insert_rowid() AS id').one().id;
        return { changes, lastInsertRowid };
      },
    };
  }
}
