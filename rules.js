export const REVISION='8af99abaf50b33903147d89eed91d1bb3ac642dd';
export const SOURCE='https://github.com/recursive-oss/rec/blob/'+REVISION+'/engine/src/rec_mlx/server.py';
export const PARSER='https://github.com/ml-explore/mlx-lm/blob/ed1fca4cef15a824c5f1702c80f70b4cffc8e4dd/mlx_lm/server.py#L1160-L1250';
export const SAMPLING='https://github.com/recursive-oss/rec/blob/'+REVISION+'/engine/src/rec_mlx/engine.py#L23-L45';
export const ALLOWED=new Set(['model','messages','tools','tool_choice','stream','stream_options','temperature','top_p','top_k','max_tokens','max_completion_tokens','seed','stop','frequency_penalty','repetition_penalty','presence_penalty','logprobs','min_p','store','grammar','parallel_tool_calls']);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);

// Keep exact top-level value lexemes. JSON.parse alone erases 15000.0 vs 15000
// and rounds large integer seeds. Supported-field copies retain the original text.
export function entries(raw){
 const tokens=[...raw.matchAll(/"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]/g)].map(m=>({s:m[0],start:m.index,end:m.index+m[0].length}));
 const out=[];let i=1;
 while(i<tokens.length-1){
  const key=JSON.parse(tokens[i].s);i+=2;const first=i,start=tokens[i].start;
  if(tokens[i].s==='{'||tokens[i].s==='['){let depth=0;do{if(tokens[i].s==='{'||tokens[i].s==='[')depth++;if(tokens[i].s==='}'||tokens[i].s===']')depth--;i++;}while(depth>0);}
  else i++;
  out.push({key,raw:raw.slice(start,tokens[i-1].end),token:tokens[first].s});
  if(tokens[i]?.s===',')i++;else break;
 }
 return out;
}
const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const isNumber=x=>typeof x==='number'&&Number.isFinite(x);
const pyEqualNumber=(x,n)=>(isNumber(x)&&x===n)||(typeof x==='boolean'&&Number(x)===n);
const integerLiteral=x=>typeof x==='string'&&/^-?(?:0|[1-9]\d*)$/.test(x);

export function inspectRequest(raw,{defaultGrammar='flint'}={}){
 const findings=[];const add=(kind,code,field,message,url=SOURCE)=>findings.push({kind,code,field,message,url});
 if(raw.length>131072)return {parsed:false,findings:[{kind:'blocked',code:'input-size',field:'JSON',message:'Use a smaller request for this local review.'}],supported:null};
 let d;
 try{d=JSON.parse(raw);}catch{return {parsed:false,findings:[{kind:'blocked',code:'json',field:'JSON',message:'This is not valid JSON. Check quotes, commas and brackets.'}],supported:null};}
 if(!isObject(d))return {parsed:false,findings:[{kind:'blocked',code:'object',field:'JSON',message:'The request must be a JSON object.'}],supported:null};
 const pairs=entries(raw),last=new Map(pairs.map(p=>[p.key,p]));
 const seen=new Set(),duplicateSet=new Set();
 for(const p of pairs){if(seen.has(p.key))duplicateSet.add(p.key);seen.add(p.key);}
 const duplicates=[...duplicateSet];
 for(const field of duplicates)add('note','duplicate',field,'This key occurs more than once. The Python server uses the last value.');
 for(const field of Object.keys(d))if(!ALLOWED.has(field)){
  const detail=field==='response_format'?'It does not enable structured response output here.':/reasoning|thinking|chat_template/.test(field)?'It does not apply a separate reasoning budget or template override here.':'The server removes this top-level field.';
  add('ignored','unknown',field,detail,SOURCE+'#L134-L175');
 }
 if(d.model!=='flint')add('blocked','model','model','This server requires the API model name "flint".',SOURCE+'#L177-L183');
 const roles=new Set(['system','developer','user','assistant','tool']);
 if(!Array.isArray(d.messages)||d.messages.length===0||d.messages.some(m=>!isObject(m)||!roles.has(m.role)))add('blocked','messages','messages','Use a nonempty messages array with system, developer, user, assistant or tool roles.',SOURCE+'#L217-L222');
 if(Array.isArray(d.messages)&&d.messages.some(m=>isObject(m)&&own(m,'reasoning')&&own(m,'reasoning_content')))add('blocked','reasoning-fields','messages','Use one reasoning field per message, rather than both reasoning and reasoning_content.',SOURCE+'#L231-L236');
 const grammar=own(d,'grammar')?d.grammar:defaultGrammar;
 if(!['flint','none'].includes(grammar))add('blocked','grammar','grammar','Only "flint" and "none" are supported.',SOURCE+'#L205-L209');
 const stop=d.stop;
 const stopValid=stop==null||(typeof stop==='string'&&stop.length>0)||(Array.isArray(stop)&&stop.every(s=>typeof s==='string'&&s.length>0));
 if(!stopValid)add('blocked','stop-type','stop','Use null, a nonempty string, or an array of nonempty strings. An empty array is accepted.',SOURCE+'#L191-L197');
 if(grammar==='flint'&&stopValid&&((typeof stop==='string'&&stop.length>0)||(Array.isArray(stop)&&stop.length>0)))add('blocked','stop-grammar','stop','Custom stops cannot be combined with Flint grammar.',SOURCE+'#L205-L209');
 const choice=own(d,'tool_choice')?d.tool_choice:'auto';
 if(choice!=='auto'&&choice!=='none')add('blocked','tool-choice','tool_choice','Only "auto" and "none" are implemented. Forced tool calls are not supported.',SOURCE+'#L198-L204');
 if(choice==='none'&&own(d,'tools'))add('note','tools-removed','tools','tool_choice="none" removes tools before prompt and grammar construction.',SOURCE+'#L198-L204');
 if(own(d,'parallel_tool_calls')&&(typeof d.parallel_tool_calls!=='boolean'||d.parallel_tool_calls===false))add('blocked','parallel','parallel_tool_calls','Omit this field or use literal true. false is not implemented.',SOURCE+'#L210-L216');
 for(const field of ['stream','logprobs'])if(own(d,field)&&typeof d[field]!=='boolean')add('blocked','boolean',field,'Use a JSON boolean.',PARSER);
 if(d.stream===true&&d.logprobs===true)add('blocked','stream-logprobs','logprobs','Token logprobs require stream=false.',SOURCE+'#L180-L181');
 if(own(d,'store')&&d.store!==false)add('blocked','store','store','Stored-completion retrieval is unsupported. Use literal false or omit the field.',SOURCE+'#L189-L190');
 if(d.stream_options!=null&&(!isObject(d.stream_options)||Object.keys(d.stream_options).length!==1||!own(d.stream_options,'include_usage')||!pyEqualNumber(d.stream_options.include_usage,1)))add('blocked','stream-options','stream_options','Use {"include_usage":true} or omit stream_options.',SOURCE+'#L223-L224');
 for(const [field,neutral] of [['frequency_penalty',0],['min_p',0],['repetition_penalty',1]])if(own(d,field)&&!pyEqualNumber(d[field],neutral))add('blocked','neutral',field,'This decoder only supports the neutral value '+neutral+'.',SOURCE+'#L184-L188');
 for(const [field,min,max,exclusive] of [['temperature',0,2,false],['top_p',0,1,true],['presence_penalty',-2,2,false]])if(own(d,field)&&(!isNumber(d[field])||(exclusive?d[field]<=min:d[field]<min)||d[field]>max))add('blocked','sampling',field,`Use a JSON number ${exclusive?'greater than '+min+' and up to '+max:'from '+min+' through '+max}. Booleans are not sampling numbers.`,SAMPLING);
 if(own(d,'top_k')&&(!integerLiteral(last.get('top_k')?.raw)||BigInt(last.get('top_k').raw)<0n))add('blocked','integer','top_k','Use a nonnegative integer literal, without a decimal point or exponent.',PARSER);
 const capField=d.max_completion_tokens!=null?'max_completion_tokens':own(d,'max_tokens')?'max_tokens':null;
 let cap=null;
 if(capField){
  const literal=last.get(capField).raw;
  if(!integerLiteral(literal)||BigInt(literal)<=0n)add('blocked','integer',capField,'Use a positive integer literal. 15000.0 and 1e3 are Python floats, even when their numeric value is integral.',PARSER);
  else{cap=literal;add('note','total-cap',capField,'Total output cap '+literal+' before the context clamp. This includes reasoning and answer/tool-call tokens.',SOURCE+'#L249-L262');}
  if(capField==='max_completion_tokens'&&own(d,'max_tokens'))add('note','precedence','max_tokens','max_completion_tokens takes precedence; max_tokens does not set the effective limit.',SOURCE+'#L249-L254');
 }else add('note','unbounded','output limit','No per-request output cap. HTTP generation can use the remaining context; the terminal chat default is different.',SOURCE+'#L249-L254');
 if(own(d,'seed')&&d.seed!==null){
  const literal=last.get('seed').raw,maximum=(1n<<64n)-1n;
  if(!integerLiteral(literal)||BigInt(literal)<0n||BigInt(literal)>maximum)add('blocked','seed','seed','Use a nonnegative integer literal within the 64-bit seed range.',SAMPLING);
  else if(cap&&BigInt(literal)>((1n<<64n)-BigInt(cap)))add('note','seed-context','seed','The seed limit depends on the context-clamped output budget. Check this near-limit seed on the running server.',SAMPLING);
 }
 const kept=pairs.filter(p=>ALLOWED.has(p.key));
 const supported='{\n'+kept.map(p=>'  '+JSON.stringify(p.key)+': '+p.raw).join(',\n')+'\n}';
 return {parsed:true,findings,supported,grammar,cap,ignored:findings.filter(f=>f.kind==='ignored').length,blocked:findings.filter(f=>f.kind==='blocked').length};
}
