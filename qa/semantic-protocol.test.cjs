'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const protocol = require('../semantic-protocol');
const base = {topic:'reading',theme:'Чтение',main:'book',secondary:'none',secondaryRole:'background',exclude:[],layout:'cluster'};
const decode = (values,excluded=[],input='') => protocol.decode(JSON.stringify({...base,...values}),excluded,input);
test('semantic domains constrain an unrelated object choice',()=>{
 assert.equal(decode({topic:'audio',main:'folder'}).items[0].key,'phones');
});
test('an unsupported topic cannot become a decorative random object',()=>{
 assert.equal(decode({topic:'unsupported',main:'book',secondary:'pen'}).items.length,0);
});
test('literal subject has priority over a related but wrong model choice',()=>{
 assert.equal(decode({topic:'communication',main:'phone'},[],'Новая гарнитура').items[0].key,'phones');
});
test('hard exclusions survive topic grounding and a forbidden secondary',()=>{
 const plan=decode({topic:'finance',main:'folder',secondary:'wallet'},['wallet','coin']);
 assert.deepEqual(plan.items,[{key:'phone',role:'main'}]);
});
test('closed schema rejects unknown topics, objects and roles',()=>{
 for(const values of [{topic:undefined},{topic:'weather'},{main:'tree'},{secondaryRole:'hidden'},{exclude:['other']}]) {
  assert.throws(()=>decode(values),TypeError);
 }
});
test('thinking wrappers and fixed JSON fences are decoded',()=>{
 assert.equal(protocol.decode('<think></think>\n```json\n'+JSON.stringify(base)+'\n```').items[0].key,'book');
});
