'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const protocol=require('../semantic-protocol');
const planner=require('../planner');
function setup(fetch,{pageProtocol='http:',clock=Date}={}) {
 const workers=[];
 class Worker {
  constructor(){workers.push(this);}
  postMessage(message){this.message=message;}
  terminate(){this.terminated=true;}
 }
 const sandbox={fetch,Worker,location:{protocol:pageProtocol},navigator:{gpu:{}},
  IllustrationPlanner:planner,IllustrationSemanticProtocol:protocol,AbortController,AbortSignal,DOMException,Date:clock,console};
 vm.createContext(sandbox);vm.runInContext(fs.readFileSync(require.resolve('../local-intelligence.js'),'utf8'),sandbox);
 return {api:sandbox.LocalIllustrationIntelligence,workers};
}
function deferred(){return Promise.withResolvers();}
test('cancelling capability discovery cannot start a worker afterward',async()=>{
 const wait=deferred();const {api,workers}=setup(()=>wait.promise);
 const controller=new AbortController();
 const pending=api.suggest('Новая глава',{signal:controller.signal});
 controller.abort();wait.resolve({ok:true,json:async()=>({localModel:false})});
 await assert.rejects(pending,{name:'AbortError'});
 assert.equal(workers.length,0);
});
test('a second analysis is rejected while capability discovery is pending',async()=>{
 const wait=deferred();const {api}=setup(()=>wait.promise);const controller=new AbortController();
 const first=api.suggest('Новая глава',{signal:controller.signal});
 await assert.rejects(api.suggest('Музыка'),/Дождитесь/);
 controller.abort();wait.resolve({ok:false});await assert.rejects(first,{name:'AbortError'});
});
test('cancelled worker results cannot overwrite a newer request',async()=>{
 const {api,workers}=setup(async()=>({ok:false}));
 const controller=new AbortController();const first=api.suggest('Книга',{signal:controller.signal});
 await new Promise(resolve=>setImmediate(resolve));
 const old=workers[0];controller.abort();await assert.rejects(first,{name:'AbortError'});
 const second=api.suggest('Музыка');await new Promise(resolve=>setImmediate(resolve));
 const next=workers[1];
 old.onmessage({data:{id:old.message.id,type:'error',message:'old error'}});
 old.onerror();
 assert.notEqual(next.terminated,true);
 const content=JSON.stringify({topic:'audio',main:'phones',secondary:'none',secondaryRole:'background',exclude:[],layout:'cluster',theme:'Музыка'});
 next.onmessage({data:{id:next.message.id,type:'result',content}});
 assert.equal((await second).items[0].key,'phones');assert.equal(old.terminated,true);
});
test('backend analysis is cancellable and releases the request lock',async()=>{
 let posts=0;
 const {api}=setup(async(url,{signal}={})=>{
  if(url==='/api/capabilities')return {ok:true,json:async()=>({localModel:true})};
  posts++;
  if(posts===1)return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  return {ok:true,json:async()=>({plan:{items:[{key:'book',role:'main'}],status:'ok',layout:'cluster',theme:'Чтение',message:'Готово'}})};
 });
 const controller=new AbortController();const first=api.suggest('Книга',{signal:controller.signal});
 await new Promise(resolve=>setImmediate(resolve));controller.abort();await assert.rejects(first,{name:'AbortError'});
 assert.equal((await api.suggest('Книга')).items[0].key,'book');
});

test('file launch gives actionable model guidance without starting a worker',async()=>{
 const {api,workers}=setup(()=>{throw Error('unexpected fetch');},{pageProtocol:'file:'});
 await assert.rejects(api.suggest('Книга'),/локальный сервер/);
 assert.equal(workers.length,0);
});

test('an unavailable local model is rediscovered after the capability cache expires',async()=>{
 let now=10000,calls=0;
 const {api}=setup(async()=>({ok:true,json:async()=>({localModel:++calls>1})}),{clock:{now:()=>now}});
 assert.equal(await api.availability(),false);
 assert.equal(await api.availability(),false);
 assert.equal(calls,1);
 now+=5001;
 assert.equal(await api.availability(),true);
 assert.equal(calls,2);
});
