import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectRequest,entries} from './rules.js';
import {PRESETS} from './presets.js';
const base={model:'flint',messages:[{role:'user',content:'Hello'}],max_tokens:256};
const review=overrides=>inspectRequest(JSON.stringify({...base,...overrides}));
const has=(r,code)=>r.findings.some(f=>f.code===code);
test('presets distinguish ignored controls from rejected options',()=>{
 const ignored=inspectRequest(PRESETS[0].raw);assert.equal(ignored.ignored,4);assert.equal(ignored.blocked,0);
 assert(has(inspectRequest(PRESETS[1].raw),'integer'));assert(has(inspectRequest(PRESETS[2].raw),'stop-grammar'));
 assert.equal(inspectRequest(PRESETS[3].raw).cap,'512');assert.equal(inspectRequest(PRESETS[4].raw).blocked,2);
 assert.equal(inspectRequest(PRESETS[5].raw).blocked,0);
});
test('empty stop arrays and explicit null are accepted with Flint grammar',()=>{
 for(const stop of [[],null])assert.equal(review({stop}).blocked,0);
 for(const stop of ['',0,[''],[false],{}])assert(has(review({stop}),'stop-type'));
 assert(has(review({stop:['END']}),'stop-grammar'));
 assert.equal(review({stop:['END'],grammar:'none'}).blocked,0);
});
test('Python integer lexemes survive JavaScript numeric normalization',()=>{
 for(const value of ['15000.0','1e3','1E+3','true','null','0','-2']){
  assert(has(inspectRequest('{"model":"flint","messages":[{"role":"user"}],"max_tokens":'+value+'}'),'integer'),value);
 }
 for(const value of ['1','15000','100000000000000000000'])assert.equal(inspectRequest('{"model":"flint","messages":[{"role":"user"}],"max_tokens":'+value+'}').blocked,0,value);
});
test('only the effective token limit is validated',()=>{
 assert.equal(review({max_tokens:-5,max_completion_tokens:512}).blocked,0);
 assert.equal(review({max_completion_tokens:null}).cap,'256');
 assert(has(review({max_tokens:null}),'integer'));
 const noCap={...base};delete noCap.max_tokens;assert(has(inspectRequest(JSON.stringify(noCap)),'unbounded'));
});
test('copies preserve large seeds, nested integer arguments and float spellings',()=>{
 const raw='{"model":"flint","messages":[{"role":"user","content":{"x":9007199254740993}}],"seed":18446744073709551615,"temperature":1.0,"max_tokens":1,"ignored":{"x":3}}';
 const r=inspectRequest(raw);assert.equal(r.blocked,0);assert(r.supported.includes('18446744073709551615'));assert(r.supported.includes('9007199254740993'));assert(r.supported.includes('"temperature": 1.0'));assert(!r.supported.includes('"ignored"'));
});
test('seed validation avoids JavaScript precision loss',()=>{
 for(const raw of ['-1','18446744073709551616','1.0','true'])assert(has(inspectRequest('{"model":"flint","messages":[{"role":"user"}],"max_tokens":1,"seed":'+raw+'}'),'seed'));
 assert(has(inspectRequest('{"model":"flint","messages":[{"role":"user"}],"max_tokens":256,"seed":18446744073709551615}'),'seed-context'));
});
test('top-level extraction handles nested structures, escaped braces and duplicate keys',()=>{
 const raw='{"model":"no","model":"flint","messages":[{"role":"user","content":"\\\"} , {"}],"max_tokens":1,"x":[{},[1,2]]}';
 assert.equal(inspectRequest(raw).blocked,0);assert(has(inspectRequest(raw),'duplicate'));
 assert.deepEqual(entries(raw).map(e=>e.key),['model','model','messages','max_tokens','x']);
});
test('booleans follow exact server distinctions',()=>{
 assert.equal(review({frequency_penalty:false,min_p:false,repetition_penalty:true}).blocked,0);
 for(const field of ['temperature','top_p','top_k','presence_penalty'])assert(review({[field]:true}).blocked>0,field);
 assert.equal(review({store:false,parallel_tool_calls:true,stream_options:{include_usage:1}}).blocked,0);
 for(const value of [0,null,true])assert(has(review({store:value}),'store'));
 for(const value of [false,0,null])assert(has(review({parallel_tool_calls:value}),'parallel'));
});
test('sampling limits and stream options are checked',()=>{
 for(const changes of [{temperature:2.01},{temperature:null},{top_p:0},{top_p:1.1},{top_k:1.2},{top_k:-1},{presence_penalty:3}])assert(review(changes).blocked>0);
 for(const changes of [{temperature:0},{temperature:2},{top_p:.001},{top_k:0},{presence_penalty:-2},{presence_penalty:2}])assert.equal(review(changes).blocked,0);
 assert(has(review({stream:true,logprobs:true}),'stream-logprobs'));
 assert(has(review({stream_options:{include_usage:false}}),'stream-options'));
 assert(has(review({stream_options:{include_usage:true,extra:1}}),'stream-options'));
});
test('messages, aliases, tool choices and grammar are checked without assuming schema compilation',()=>{
 for(const messages of [null,[],{some:true},[null],[{}],[{role:'invalid'}]])assert(has(review({messages}),'messages'));
 assert(has(review({messages:[{role:'assistant',reasoning:'a',reasoning_content:'b'}]}),'reasoning-fields'));
 for(const model of [null,'default_model','flint-int4'])assert(has(review({model}),'model'));
 assert(has(review({tool_choice:{type:'function',function:{name:'x'}}}),'tool-choice'));
 assert(has(review({tool_choice:'none',tools:[{}]}),'tools-removed'));
 assert(has(review({grammar:null}),'grammar'));
});
test('invalid input and prototype-shaped keys cannot crash the reviewer',()=>{
 for(const raw of ['','[1]','null','true','{}','{"messages":{"some":true}}','{"__proto__":{"polluted":true},"constructor":0}'])assert.doesNotThrow(()=>inspectRequest(raw));
 assert.equal({}.polluted,undefined);assert.equal(inspectRequest('x'.repeat(131073)).parsed,false);
});
