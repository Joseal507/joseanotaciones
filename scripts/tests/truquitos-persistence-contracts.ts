import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import worker from '../../cloudflare/studyal-api/src/index'
import { WorkerTruquitosStore, restoreOrGenerateTruquitos, truquitosIdentity } from '../../lib/truquitos/artifact'
import { context, validProse } from './truquitos-simple-architecture-contracts'

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'truquitos-sql-'))
  const path = join(directory, 'results.sqlite')
  const sql = (query: string, values: unknown[] = [], first = false) => JSON.parse(execFileSync('python3', ['-c', `
import sqlite3,json,sys
conn=sqlite3.connect(sys.argv[1]);conn.row_factory=sqlite3.Row
cursor=conn.execute(sys.argv[2],json.loads(sys.argv[3]));conn.commit()
row=cursor.fetchone() if sys.argv[4]=='first' else None
print(json.dumps(dict(row) if row else None) if sys.argv[4]=='first' else json.dumps({'meta':{'changes':max(0,cursor.rowcount)}}))
`, path, query, JSON.stringify(values), first ? 'first' : 'run'], { encoding: 'utf8' }))
  sql('CREATE TABLE material_results (id TEXT PRIMARY KEY, material_id TEXT, enfoque TEXT, result_type TEXT, payload TEXT, content_hash TEXT, created_at TEXT)')
  const DB = { prepare(query: string) { return { bind(...values: unknown[]) { return {
    run: async () => sql(query, values), first: async () => sql(query, values, true),
  } } } } }
  const originalFetch = globalThis.fetch; const originalApi = process.env.STUDYAL_API_URL
  process.env.STUDYAL_API_URL = 'http://offline.worker'
  const env = { DB: DB as unknown as Parameters<typeof worker.fetch>[1]['DB'], APP_ENV: 'test', WORKER_SHARED_SECRET: 'offline-secret' }
  try {
    // Exercise the actual Worker handler and its SQL against local SQLite. No network.
    globalThis.fetch = async (input, options) => {
      const headers = new Headers(options?.headers); headers.set('x-studyal-worker-secret', 'offline-secret')
      return worker.fetch(new Request(String(input), { ...options, headers }), env)
    }
    const store = new WorkerTruquitosStore(); const identity = truquitosIdentity('owner', 'session', context.fingerprint)
    assert.equal(await store.read(identity), null)
    let calls = 0
    const artifact = await restoreOrGenerateTruquitos(identity, context, store, async params => { calls++; return validProse(params) })
    assert.equal(artifact.status, 'ready'); assert.equal(calls, 1)
    assert.deepEqual(await restoreOrGenerateTruquitos(identity, context, new WorkerTruquitosStore(), async () => { throw new Error('must restore') }), artifact)
    const row = await store.read(identity); assert(row)
    assert.equal(await store.compareAndSet(identity, null, artifact), false, 'insert cannot overwrite existing work')
    assert.equal(await store.compareAndSet(identity, 'stale', artifact), false, 'stale process cannot write')
    assert.equal(await store.compareAndSet(identity, row.revision, artifact), true)
    assert.equal(await store.compareAndSet(identity, row.revision, artifact), false, 'revision consumed atomically')
    assert.equal(sql('SELECT COUNT(*) AS n FROM material_results', [], true).n, 1)
    const unauthorized = await worker.fetch(new Request('http://offline.worker/material-results/truquitos-cas', { method: 'POST', body: '{}' }), env)
    assert.equal(unauthorized.status, 401)
    globalThis.fetch = async () => new Response('{}', { status: 200 })
    await assert.rejects(store.read(identity), /RESTORE_INVALID/)
    globalThis.fetch = async () => new Response('error', { status: 503 })
    await assert.rejects(store.read(identity), /RESTORE_FAILED/)
    globalThis.fetch = async () => new Response('{"ok":true,"result":{"payload":"broken","content_hash":"rev"}}')
    await assert.rejects(store.read(identity))
    console.log('Truquitos persistence: 11 assertions passed (real Worker SQL, offline SQLite); 0 live provider calls')
  } finally {
    globalThis.fetch = originalFetch
    if (originalApi === undefined) delete process.env.STUDYAL_API_URL; else process.env.STUDYAL_API_URL = originalApi
    rmSync(directory, { recursive: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
