import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { WorkerExamGradingStore } from '../../lib/materialBrain/examGrading'
const worker=readFileSync('cloudflare/studyal-api/src/index.ts','utf8')
const start=worker.indexOf('if (url.pathname === "/material-results/exam-grading-cas"')
const block=worker.slice(start,worker.indexOf('if (url.pathname === "/material-results/upsert"',start))
const statements=[...block.matchAll(/prepare\(`([\s\S]*?)`\)/g)].map(match=>match[1])
assert.equal(statements.length,2)
const upsertBlock=worker.slice(worker.indexOf('if (url.pathname === \"/material-results/upsert\"'))
statements.push([...upsertBlock.matchAll(/prepare\(`([\s\S]*?)`\)/g)][0][1])
const python=String.raw`
import sqlite3,json,sys,tempfile,os,concurrent.futures
insert,update,upsert=json.loads(sys.argv[1])
with tempfile.TemporaryDirectory() as directory:
 path=os.path.join(directory,'cas.db')
 db=sqlite3.connect(path)
 db.execute('CREATE TABLE material_results(id TEXT PRIMARY KEY,material_id TEXT,enfoque TEXT,result_type TEXT,payload TEXT,content_hash TEXT,created_at TEXT)')
 assert db.execute(insert,('exam','exam','{}','r0')).rowcount==1
 assert db.execute(insert,('exam','exam','{"overwrite":true}','bad')).rowcount==0
 db.commit()
 def claim(revision):
  connection=sqlite3.connect(path,timeout=5)
  result=connection.execute(update,(json.dumps({'claim':revision}),revision,'exam','r0')).rowcount
  connection.commit();connection.close();return result
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  results=list(pool.map(claim,['r1','r2']))
 assert sorted(results)==[0,1],results
 revision=db.execute('SELECT content_hash FROM material_results').fetchone()[0]
 assert db.execute(update,('{"stale":true}','r3','exam','r0')).rowcount==0
 assert db.execute(update,('{"accepted":["criterion"]}','r4','exam',revision)).rowcount==1
 db.commit();db.close()
 db=sqlite3.connect(path)
 assert json.loads(db.execute('SELECT payload FROM material_results').fetchone()[0])['accepted']==['criterion']
 for kind in ['exam_artifact','exam_manifest']:
  ready={'meta':{'status':'ready'},'questions':['frozen']} if kind=='exam_artifact' else {'status':'ready','slots':['frozen']}
  db.execute(upsert,(kind,kind,'mixto',kind,json.dumps(ready),'original',None))
  db.execute(upsert,(kind,kind,'mixto',kind,json.dumps({'status':'generating','questions':['replacement']}),'late-worker',None))
  assert json.loads(db.execute('SELECT payload FROM material_results WHERE id=?',(kind,)).fetchone()[0])==ready
 db.commit()
 print('actual Worker SQL: insert race, concurrent claim, stale write rejection, durable restart PASS')
`
console.log(execFileSync('python3',['-c',python,JSON.stringify(statements)],{encoding:'utf8'}).trim())
async function main(){
 const originalFetch=globalThis.fetch;const originalApi=process.env.STUDYAL_API_URL
 try{
  process.env.STUDYAL_API_URL='https://offline.invalid'
  globalThis.fetch=async()=>new Response('unavailable',{status:503})
  await assert.rejects(new WorkerExamGradingStore().read('identity'),/RESTORE_FAILED/)
  globalThis.fetch=async()=>Response.json({ok:true,result:null})
  assert.equal(await new WorkerExamGradingStore().read('identity'),null)
  globalThis.fetch=async()=>Response.json({ok:true})
  await assert.rejects(new WorkerExamGradingStore().read('identity'),/RESTORE_INVALID/)
 }finally{globalThis.fetch=originalFetch;if(originalApi===undefined)delete process.env.STUDYAL_API_URL;else process.env.STUDYAL_API_URL=originalApi}
 console.log('exam-grading-worker-cas-contracts: SQL concurrency and restore boundaries PASS; zero network/provider calls')
}
main().catch(error=>{console.error(error);process.exitCode=1})
