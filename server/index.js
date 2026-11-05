import path from 'node:path';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createStore } from './store.js';
import { createModel } from './model.js';
import { createApp } from './app.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const store=createStore(path.join(root,'data'));
const app=createApp({store,model:createModel()});
const production=existsSync(path.join(root,'dist','index.html'))&&!process.argv.includes('--dev');
if(production){app.use(express.static(path.join(root,'dist')));app.get('/{*path}',(_req,res)=>res.sendFile(path.join(root,'dist','index.html')));}else{const {createServer}=await import('vite');const vite=await createServer({root,server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares);}
const port=Number(process.env.PORT||5173);
const server=app.listen(port,'0.0.0.0',()=>{console.log(`知错已启动：http://localhost:${port}`);for(const addresses of Object.values(networkInterfaces()))for(const a of addresses||[])if(a.family==='IPv4'&&!a.internal)console.log(`同一 Wi-Fi 手机访问：http://${a.address}:${port}`);console.log(`DeepSeek：${process.env.DEEPSEEK_API_KEY?'已配置':'未配置；请填写 .env 后重启'}`);});
server.on('error',err=>{console.error(err.code==='EADDRINUSE'?`端口 ${port} 已被占用，请在 .env 中更换 PORT。`:err.message);process.exit(1);});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{store.close();process.exit(0);}));
