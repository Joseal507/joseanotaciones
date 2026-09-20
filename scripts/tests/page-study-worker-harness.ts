import './page-study-env'
import { DatabaseSync } from 'node:sqlite'
import { WorkerPageStudyStore } from '../../lib/pageStudy/store'

/**
 * Runs the REAL Worker (cloudflare/studyal-api/src/index.ts) in-process against a real SQLite database through a
 * D1-shaped shim. The material_results table is created with the columns every existing endpoint writes (its DDL is not
 * in the repo migrations; the shape is taken from the INSERT/UPDATE statements in the Worker itself).
 */
class D1Statement {
  constructor(private readonly db: DatabaseSync, private readonly sql: string, private readonly args: unknown[] = []) {}
  bind(...args: unknown[]) { return new D1Statement(this.db, this.sql, args) }
  async run() { const r = this.db.prepare(this.sql).run(...(this.args as never[])); return { meta: { changes: Number(r.changes) }, success: true } }
  async first() { return (this.db.prepare(this.sql).get(...(this.args as never[])) as Record<string, unknown> | undefined) ?? null }
  async all() { return { results: this.db.prepare(this.sql).all(...(this.args as never[])) as unknown[] } }
}

export interface FaultRule { match: (path: string, body: any) => boolean; times: number; mode: 'throw_before' | 'throw_after' | 'status'; status?: number }
export function makeWorker() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE material_results (id TEXT PRIMARY KEY, material_id TEXT, enfoque TEXT, result_type TEXT, payload TEXT, content_hash TEXT, created_at TEXT)`)
  const env = { DB: { prepare: (sql: string) => new D1Statement(db, sql) }, APP_ENV: 'test', WORKER_SHARED_SECRET: process.env.WORKER_SHARED_SECRET }
  const stats = { http: 0, byPath: {} as Record<string, number>, writes: 0 }
  const faults: FaultRule[] = []
  let worker: { fetch: (request: Request, env: unknown) => Promise<Response> } | null = null
  const workerPath = ['..', '..', 'cloudflare', 'studyal-api', 'src', 'index'].join('/')   // dynamic: keeps tsc from type-checking the Worker source

  const request = (async (input: RequestInfo | URL, init?: RequestInit) => {
    worker ||= (await import(workerPath)).default
    const url = new URL(String(input)); stats.http++
    stats.byPath[url.pathname] = (stats.byPath[url.pathname] || 0) + 1
    let body: any = null
    try { body = init?.body ? JSON.parse(String(init.body)) : null } catch { /* not json */ }
    const rule = faults.find(f => f.times > 0 && f.match(url.pathname, body))
    if (rule) {
      rule.times--
      if (rule.mode === 'throw_before') throw new Error('network down')
      if (rule.mode === 'status') return new Response('Not Found', { status: rule.status ?? 404 })
    }
    const response = await worker!.fetch(new Request(url, init as RequestInit), env)
    if (init?.method === 'POST') stats.writes++
    if (rule?.mode === 'throw_after') throw new Error('response lost after write')
    return response
  }) as typeof fetch

  return {
    db, env, stats, faults, request,
    store: new WorkerPageStudyStore('https://worker.test', request),
    rows: (type?: string) => db.prepare(type ? 'SELECT * FROM material_results WHERE result_type = ?' : 'SELECT * FROM material_results').all(...(type ? [type] : [])) as Array<Record<string, any>>,
  }
}
