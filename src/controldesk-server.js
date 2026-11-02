import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

/** One HTTP listener: existing authenticated APIs and the native ControlDesk UI. */
export async function createControlDeskServer({api,host='127.0.0.1',port=3000,dev=false,webDirectory=path.join(root,'apps/web')}){
 const require=createRequire(path.join(webDirectory,'package.json'));
 const next=require('next');
 let web;
 const sockets=new Set();
 const server=http.createServer(async(req,res)=>{
  try{
   const pathname=new URL(req.url,'http://localhost').pathname;
   if(pathname.startsWith('/api/')||pathname==='/quotation-print.css')return await api(req,res);
   return await web.getRequestHandler()(req,res);
  }catch{
   // Never print request bodies, connector credentials, or database errors.
   if(!res.headersSent){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:'ControlDesk is temporarily unavailable.'}));}
   else res.end();
  }
 });
 server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
 web=next({dev,dir:webDirectory,hostname:host,port,httpServer:server});
 try{await web.prepare();}catch(error){await web.close().catch(()=>{});throw error;}
 return {server,async close(){for(const socket of sockets)socket.destroy();if(server.listening)await new Promise(resolve=>server.close(resolve));await web.close();}};
}
