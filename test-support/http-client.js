import {Readable} from 'node:stream';
/** Exercise the real handler without a listener, network or extra port. */
export function testFetch(app){return async(input,options={})=>{
 const url=new URL(input,'http://127.0.0.1:3000'),headers=Object.fromEntries(new Headers(options.headers).entries());
 const req=Readable.from(options.body==null?[]:[Buffer.isBuffer(options.body)?options.body:Buffer.from(options.body)]);
 Object.assign(req,{method:options.method||'GET',url:url.pathname+url.search,headers:{host:url.host,...headers},socket:{remoteAddress:'test'}});
 const responseHeaders=new Headers(),chunks=[];
 const res={statusCode:200,headersSent:false,setHeader(key,value){responseHeaders.set(key,Array.isArray(value)?value.join(', '):String(value));},getHeader(key){return responseHeaders.get(key);},hasHeader(key){return responseHeaders.has(key);},writeHead(status,values={}){this.statusCode=status;for(const [key,value]of Object.entries(values))this.setHeader(key,value);this.headersSent=true;},write(value){chunks.push(Buffer.from(value));},end(value){if(value!=null)chunks.push(Buffer.from(value));this.headersSent=true;}};
 await app(req,res);return new Response([204,304].includes(res.statusCode)?null:Buffer.concat(chunks),{status:res.statusCode,headers:responseHeaders});
};}
