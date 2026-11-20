'use strict';
const $ = id => document.getElementById(id);
const catalog = {
  flowers:['Букет','букет цвет тюльпан ваз','подар весн праздник уют свидан'],
  book:['Книга','книг учебник','уч учё образован чтени знани экзамен'],
  phone:['Телефон','телефон смартфон мобильник','связ звон онлайн цифров прилож'],
  puzzle:['Пазлы','пазл головолом','решени задач команд иде стратег'],
  coin:['Монета','монет копейк','деньг денеж финанс доход накоп бюджет'],
  phones:['Наушники','наушник гарнитур','музык звук подкаст слуш аудио'],
  lamp:['Лампа','ламп светильник','свет вдохнов вечер иде рабоч'],
  wallet:['Кошелёк','кошел кошель портмон','финанс деньг оплат покуп бюджет сбереж'],
  folder:['Папка','папк папок','документ офис архив проект работ'],
  pen:['Ручка','ручк перо','писат запис замет конспект уч рисова']
};
const names=Object.keys(catalog), formats=[[1200,630],[1000,1000],[800,1200]];
const palettes=SWATCHES.map(colors=>colors.slice());
let objects=[], selected=0, serial=0, variant=0, scale=1, drag=null;
const canvas=$('canvas'), dims=()=>formats[$('format').selectedIndex];
function asset(item){
  const index=($('detail').value==='S'?2:0)+Number(item.mono);
  return ART[item.key][index];
}
function size(item){
  const [,w,h]=asset(item).match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  return [Number(w),Number(h)];
}
function paint(svg,source,target,prefix){
  const colors=new Map(source.map((c,i)=>[c.toLowerCase(),target[i]]));
  return svg.replace(/(fill|stroke|stop-color)="(#[a-f\d]{6}|white|black)"/gi,(all,k,v)=>{
    const c=v==='white'?'#ffffff':v==='black'?'#181817':v.toLowerCase();
    return k+'="'+(colors.get(c)||v)+'"';
  }).replace(/id="([^"]+)"/g,(_,id)=>'id="'+prefix+id+'"').replace(/url\(#([^)]*)\)/g,(_,id)=>'url(#'+prefix+id+')');
}
function make(key){return {id:++serial,key,x:0,y:0,angle:0,mono:false};}
function layout(){
  if(!objects.length)return;
  const [W,H]=dims(), n=objects.length, order=objects.slice();
  if(variant%3===1)order.reverse();
  if(variant%3===2)order.push(order.shift());
  const cols=Math.min(n,Math.max(1,Math.round(Math.sqrt(n*W/H)))),rows=Math.ceil(n/cols);
  const boxes=order.map(size);
  const gap=Math.min(W,H)*.033, cellH=(H*.89-gap*(rows-1))/rows;
  const lines=Array.from({length:rows},(_,i)=>boxes.slice(i*cols,(i+1)*cols));
  scale=Math.min(...lines.flatMap(line=>[(W*.92-gap*(line.length-1))/line.reduce((s,b)=>s+b[0],0),cellH/Math.max(...line.map(b=>b[1]))]));
  lines.forEach((line,row)=>{
    let x=(W-line.reduce((s,b)=>s+b[0]*scale,0)-gap*(line.length-1))/2;
    line.forEach(([w,h],col)=>{
      const o=order[row*cols+col]; o.x=x+w*scale/2;
      o.y=H*.055+row*(cellH+gap)+cellH/2+(variant%2===0?1:-1)*(col%2===0?-1:1)*(cellH-h*scale)*.30;
      x+=w*scale+gap;
    });
  });
}
function transform(o){const [w,h]=size(o);return 'translate('+o.x+' '+o.y+') rotate('+o.angle+') scale('+scale+') translate('+(-w/2)+' '+(-h/2)+')';}
function render(){
  const [W,H]=dims(), p=$('palette').selectedIndex, bg=p<3?p:0, colors=palettes[p];
  canvas.setAttribute('viewBox','0 0 '+W+' '+H);
  const back=ART.back[bg+($('detail').value==='S'?3:0)];
  canvas.innerHTML=paint(back,SWATCHES[bg],colors,'bg').replace(/<svg width="[^"]+" height="[^"]+"/,'<svg preserveAspectRatio="none" width="'+W+'" height="'+H+'"')+
    objects.map(o=>'<g data-id="'+o.id+'" aria-label="'+catalog[o.key][0]+'" transform="'+transform(o)+'"><title>'+catalog[o.key][0]+'</title>'+paint(asset(o),SWATCHES[0],colors,'obj'+o.id+'_')+'</g>').join('');
  $('dimensions').textContent=W+' × '+H+' px';
  $('chips').innerHTML=colors.map(c=>'<i style="background:'+c+'"></i>').join('');
  $('layers').replaceChildren(...objects.slice().reverse().map(o=>{
    const b=document.createElement('button');b.textContent=catalog[o.key][0];b.classList.toggle('active',o.id===selected);b.onclick=()=>{selected=o.id;render()};return b;
  }));
  const o=objects.find(v=>v.id===selected);$('edit').disabled=!o;$('mono').checked=!!o?.mono;
}
function normalized(s){return s.toLowerCase().replaceAll('ё','е');}
function hits(words,stems){return words.filter(w=>stems.split(' ').some(t=>w.startsWith(normalized(t)))).length;}
function generate(){
  const words=normalized($('query').value).match(/[а-яa-z]+/g)||[];
  const explicit=$('mode').selectedIndex===1;
  const scored=names.map(key=>({key,score:hits(words,catalog[key][1])*10+(explicit?0:hits(words,catalog[key][2]))})).filter(r=>r.score).sort((a,b)=>b.score-a.score);
  if(!scored.length){$('status').textContent='Совпадений нет. Попробуйте тему «музыка» или добавьте предмет из библиотеки.';return;}
  const missing=explicit?words.filter(w=>!['и','с','со'].includes(w)&&!names.some(k=>hits([w],catalog[k][1]))):[];
  objects=(explicit?scored:scored.slice(0,3)).map(r=>make(r.key));variant=0;selected=objects[0].id;
  layout();render();$('status').textContent=missing.length?'Не найдены: '+missing.join(', '):'Собрано предметов: '+objects.length;
}
function move(o,x,y){const [W,H]=dims();o.x=Math.min(W,Math.max(0,x));o.y=Math.min(H,Math.max(0,y));}
function operate(op){
  const i=objects.findIndex(o=>o.id===selected),o=objects[i];if(!o)return;
  if(op==='rotate')o.angle=(o.angle+15)%360;
  if(op==='copy'){const c={...o,id:++serial};move(c,c.x+18,c.y+18);objects.splice(i+1,0,c);selected=c.id;}
  if(op==='remove'){objects.splice(i,1);selected=objects.at(-1)?.id||0;}
  if(op==='front'||op==='rear'){objects.splice(i,1);objects.splice(op==='front'?objects.length:0,0,o);}
  const offsets={left:[-8,0],right:[8,0],up:[0,-8],down:[0,8]};
  if(offsets[op])move(o,o.x+offsets[op][0],o.y+offsets[op][1]);render();
}
$('edit').onclick=e=>{if(e.target.dataset.op)operate(e.target.dataset.op)};
$('mono').onchange=e=>{objects.find(o=>o.id===selected).mono=e.target.checked;render()};
$('generate').onclick=generate;
$('mode').onchange=()=>{$('promptLabel').textContent=$('mode').selectedIndex?'Названия через запятую':'Заголовок или метафора';$('query').value=$('mode').selectedIndex?'Книга, телефон':'Учусь управлять деньгами';};
$('vary').onclick=()=>{variant++;layout();render()};
$('format').onchange=()=>{layout();render()};
let prevDetail='L';
$('detail').onchange=()=>{scale*=prevDetail==='L'?2:.5;prevDetail=$('detail').value;render()};
$('palette').onchange=render;
$('upload').onchange=async e=>{
  try{const data=JSON.parse(await e.target.files[0].text());
    if(!Array.isArray(data.colors)||data.colors.length!==8||!data.colors.every(c=>typeof c==='string'&&/^#[\da-f]{6}$/i.test(c)))throw Error();
    palettes.push(data.colors);$('palette').add(new Option(String(data.name||'Своя схема')));$('palette').selectedIndex=palettes.length-1;render();$('status').textContent='Палитра применена.';
  }catch{$('status').textContent='Нужен JSON с массивом colors из восьми цветов #RRGGBB. См. образец.';}finally{e.target.value='';}
};
function point(e){return new DOMPoint(e.clientX,e.clientY).matrixTransform(canvas.getScreenCTM().inverse());}
canvas.onpointerdown=e=>{
  const g=e.target.closest('[data-id]');if(!g||e.button!==0)return;
  const o=objects.find(v=>v.id===Number(g.dataset.id)),p=point(e);
  selected=o.id;drag={o,dx:p.x-o.x,dy:p.y-o.y};canvas.setPointerCapture(e.pointerId);canvas.focus();render();
};
canvas.onpointermove=e=>{if(!drag)return;const p=point(e);move(drag.o,p.x-drag.dx,p.y-drag.dy);canvas.querySelector('[data-id="'+selected+'"]').setAttribute('transform',transform(drag.o));};
canvas.onlostpointercapture=()=>{drag=null};
canvas.onkeydown=e=>{const op={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down',Delete:'remove'}[e.key];if(op){e.preventDefault();operate(op)}};
for(const key of names){
  const b=document.createElement('button'),img=document.createElement('img');img.alt='';img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(ART[key][2]);
  b.append(img,catalog[key][0]);b.title='Добавить: '+catalog[key][0];b.onclick=()=>{const o=make(key);objects.push(o);selected=o.id;layout();render()};$('library').append(b);
}
function svgFile(){
  const root=canvas.cloneNode(true),[W,H]=dims();
  for(const attr of ['id','tabindex','aria-label'])root.removeAttribute(attr);
  root.setAttribute('width',W);root.setAttribute('height',H);
  for(const g of root.querySelectorAll('[data-id]')){g.setAttribute('id',g.getAttribute('aria-label')+'-'+g.dataset.id);g.removeAttribute('data-id');}
  return new XMLSerializer().serializeToString(root);
}
$('save').onclick=()=>{const url=URL.createObjectURL(new Blob([svgFile()],{type:'image/svg+xml'}));const a=document.createElement('a');a.href=url;a.download='Складная-'+dims().join('x')+'.svg';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);};
generate();

