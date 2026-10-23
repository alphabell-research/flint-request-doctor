import {inspectRequest,REVISION,SOURCE,PARSER,SAMPLING} from './rules.js';
import {PRESETS} from './presets.js';
const $=id=>document.getElementById(id);let latest,toastTimer,reviewTimer;
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3000);}
function render(){
 clearTimeout(reviewTimer);$('copy-fallback').hidden=true;
 latest=inspectRequest($('request').value,{defaultGrammar:$('grammar-default').value});
 const blocked=latest.findings.filter(f=>f.kind==='blocked').length,ignored=latest.findings.filter(f=>f.kind==='ignored').length,notes=latest.findings.filter(f=>f.kind==='note').length;
 $('summary').textContent=!latest.parsed?'Check JSON':blocked?'Settings rejected':ignored?'Fields ignored':'No blockers found';
 $('counts').replaceChildren();
 for(const [kind,count,label] of [['blocked',blocked,'Rejected'],['ignored',ignored,'Ignored'],['note',notes,'Notes']]){const el=document.createElement('div');el.className='count';el.dataset.kind=kind;const strong=document.createElement('strong');strong.textContent=count;el.append(strong,document.createTextNode(label));$('counts').append(el);}
 $('findings').replaceChildren();
 const order={blocked:0,ignored:1,note:2};
 for(const f of [...latest.findings].sort((a,b)=>order[a.kind]-order[b.kind])){
  const el=document.createElement('article');el.className='finding';el.dataset.kind=f.kind;
  const head=document.createElement('div');head.className='finding-head';const field=document.createElement('code');field.textContent=f.field;const kind=document.createElement('span');kind.className='kind';kind.textContent={blocked:'Rejected',ignored:'Ignored',note:'Note'}[f.kind];head.append(field,kind);
  const text=document.createElement('p');text.textContent=f.message;el.append(head,text);
  if(f.url){const a=document.createElement('a');a.href=f.url;a.target='_blank';a.rel='noopener';a.textContent='Pinned source ↗';el.append(a);}
  $('findings').append(el);
 }
 $('copy').disabled=!latest.parsed;
}
function loadPreset(){const p=PRESETS.find(p=>p.id===$('preset').value)||PRESETS[0];$('request').value=p.raw;render();}
for(const p of PRESETS){const option=document.createElement('option');option.value=p.id;option.textContent=p.name;$('preset').append(option);}
const selected=new URLSearchParams(location.search).get('example');if(PRESETS.some(p=>p.id===selected))$('preset').value=selected;
$('load').addEventListener('click',loadPreset);$('review').addEventListener('click',render);$('grammar-default').addEventListener('change',render);
$('request').addEventListener('input',()=>{clearTimeout(reviewTimer);$('summary').textContent='Review pending';$('copy').disabled=true;$('copy-fallback').hidden=true;reviewTimer=setTimeout(render,180);});
$('copy').addEventListener('click',async()=>{render();if(!latest.supported)return;try{await navigator.clipboard.writeText(latest.supported);toast(latest.blocked?'Supported fields copied. Rejected settings still need changes.':'Supported fields copied. Original number text preserved.');}catch{$('copy-fallback').hidden=false;$('copy-fallback').open=true;$('filtered').value=latest.supported;$('filtered').focus();$('filtered').select();toast('Select and copy the supported fields below.');}});
$('revision').href='https://github.com/recursive-oss/rec/commit/'+REVISION;
for(const [label,url] of [['Request rules',SOURCE+'#L134-L262'],['Inherited types',PARSER],['Sampling rules',SAMPLING]]){const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';a.textContent=label+' ↗';$('sources').append(a);}
loadPreset();
