'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const protocol = require('./semantic-protocol.js');
const planner = require('./planner.js');
const root = __dirname;
const port = Number(process.env.PORT || 8183);
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.mp4':'video/mp4','.md':'text/plain; charset=utf-8','.png':'image/png'};
function json(res,code,body) {
  res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(body));
}
http.createServer(async(req,res)=>{
  const url = new URL(req.url,'http://localhost');
  if(url.pathname === '/api/capabilities') {
    try {
      const result=await fetch('http://127.0.0.1:11434/api/tags',{signal:AbortSignal.timeout(2000)});
      const list=await result.json();
      return json(res,200,{localModel:list.models?.some(item=>item.name===protocol.model)||false});
    } catch {return json(res,200,{localModel:false});}
  }
  if(url.pathname === '/api/interpret' && req.method==='POST') {
    const origin=req.headers.origin;
    if(origin && origin !== 'http://127.0.0.1:'+port && origin !== 'http://localhost:'+port) return json(res,403,{error:'Origin rejected'});
    let body='';
    try {
      for await(const chunk of req) {
        body+=chunk;
        if(body.length>4096) return json(res,413,{error:'Слишком длинный запрос.'});
      }
      const {input}=JSON.parse(body);
      const excluded=planner.excludedKeys(input);
      const messages=protocol.messages(input,excluded);
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),90000);
      res.on('close',()=>controller.abort());
      try {
        const result=await fetch('http://127.0.0.1:11434/api/chat',{
          method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
          body:JSON.stringify({model:protocol.model,messages,format:protocol.schema,stream:false,think:false,
            options:{num_ctx:2048,num_predict:220,temperature:0}})
        });
        if(!result.ok) throw Error('Не удалось выполнить анализ в Ollama.');
        const output=await result.json();
        return json(res,200,{plan:protocol.decode(output.message?.content,excluded)});
      } finally {clearTimeout(timeout);}
    } catch(error) {
      if(!res.destroyed) return json(res,400,{error:error.message});
      return;
    }
  }
  if(req.method !== 'GET' && req.method !== 'HEAD') return json(res,405,{error:'Method not allowed'});
  let filename;
  try {filename=decodeURIComponent(url.pathname);} catch{return json(res,400,{error:'Invalid path'});}
  const relative=filename==='/'?'index.html':filename.slice(1);
  const resolved=path.resolve(root,relative);
  const inside=path.relative(root,resolved);
  if(inside.startsWith('..') || path.isAbsolute(inside) || relative.split(/[\\/]/).some(part=>part.startsWith('.'))) return json(res,404,{error:'Not found'});
  fs.stat(resolved,(err,stat)=>{
    if(err || !stat.isFile()) return json(res,404,{error:'Not found'});
    res.writeHead(200,{'Content-Type':mime[path.extname(resolved)]||'application/octet-stream','Content-Length':stat.size,'X-Content-Type-Options':'nosniff'});
    if(req.method==='HEAD')return res.end();
    fs.createReadStream(resolved).pipe(res);
  });
}).listen(port,'127.0.0.1',()=>console.log('Складная с анализом метафор: http://127.0.0.1:'+port));
