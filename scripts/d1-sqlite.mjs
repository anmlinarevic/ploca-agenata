// Zajednički dio testova bez wranglera: prave migracije na SQLite bazi (node:sqlite) iza malog D1 adaptera.
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';

/** Najmanji D1 adapter za ovaj test: prepare/bind/run/all/first i batch u transakciji. */
export function d1(db) {
  const st = (sql) => {
    let a = [];
    const o = {
      bind(...x) { a = x; return o; },
      run() { const r = db.prepare(sql).run(...a); return Promise.resolve({ success: true, meta: { changes: Number(r.changes) } }); },
      all() { return Promise.resolve({ results: db.prepare(sql).all(...a) }); },
      first() { return Promise.resolve(db.prepare(sql).get(...a) ?? null); },
      _sync() { return db.prepare(sql).run(...a); },
    };
    return o;
  };
  return {
    prepare: st,
    async batch(lista) {
      db.exec('BEGIN');
      try { lista.forEach((s) => s._sync()); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
      return lista.map(() => ({ success: true }));
    },
  };
}
const migracije = readdirSync('packages/db/migrations').filter((f) => f.endsWith('.sql')).sort();
/** Primijeni migracije od broja `od` do broja `do_` (uključivo). */
export const primijeni = (db, do_ = 99, od = 1) => migracije.filter((f) => +f.slice(0, 4) <= do_ && +f.slice(0, 4) >= od)
  .forEach((f) => db.exec(readFileSync(`packages/db/migrations/${f}`, 'utf8')));
/** Nova baza u memoriji s migracijama do `do_` i zakupcima t1 i t2. */
export const nova = (do_ = 99) => { const db = new DatabaseSync(':memory:'); primijeni(db, do_); db.exec(`INSERT INTO tenants (id, naziv) VALUES ('t1', 'Test'), ('t2', 'Drugi')`); return db; };
