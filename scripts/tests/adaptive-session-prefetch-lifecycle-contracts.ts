import assert from 'node:assert/strict'
import { KeyedPromiseCache, shouldPrefetchSession } from '../../lib/adaptive/sessionPrefetch'

async function main(){
const cache=new KeyedPromiseCache<number>();let calls=0;let release!:()=>void
const gate=new Promise<void>(resolve=>{release=resolve})
const first=cache.run('same',async()=>{calls+=1;await gate;return 7})
const second=cache.run('same',async()=>{calls+=1;return 8})
assert.equal(first,second);assert.equal(calls,1);release();assert.equal(await second,7);assert.equal(cache.metrics.duplicateSuppressed,1)
let aborted=false
const pending=cache.run('cancel',signal=>new Promise<number>((_,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Object.assign(new Error('aborted'),{name:'AbortError'}))},{once:true})))
cache.cancelAll();await assert.rejects(pending,{name:'AbortError'});assert.equal(aborted,true);assert.equal(cache.metrics.aborted,1)
assert.equal(shouldPrefetchSession('learning'),true);assert.equal(shouldPrefetchSession('final_review'),false)
console.log('adaptive-session-prefetch-lifecycle-contracts: 8/8 PASS; duplicate underlying generation=0; cancellation PASS')
}
void main()
