import { createControlDeskServer } from './controldesk-server.js';
import { createApp } from './app.js';
import { getConfig } from './config.js';
import { openDatabase } from './db.js';
import { markStalledRuns } from './tally-import.js';

const dev=process.argv.includes('--dev');
process.env.NODE_ENV ||= dev?'development':'production';
process.env.NEXT_DIST_DIR ||= dev?'.next-dev':'.next';
const config = getConfig();
const db = (await openDatabase(config));
const app = createApp({ db, config });
let combined;
try{combined=await createControlDeskServer({api:app,host:config.host,port:config.port,dev});}
catch{await app.close();await db.close();console.error('ControlDesk could not start. Run npm.cmd run build before npm.cmd start, or use npm.cmd run dev.');process.exit(1);}
const {server}=combined;
const stalledRunTimer=setInterval(()=>markStalledRuns(db.sql,config.tallyStalledRunMinutes).catch(error=>console.error('Stalled-run maintenance failed:',error.code||error.name)),30_000);
stalledRunTimer.unref();
if (config.schedulerEnabled) app.modules.scheduler.start();

server.once('error',error=>{
  console.error(error.code==='EADDRINUSE'?'ControlDesk is already running on this port. Open its address or stop it before restarting.':'ControlDesk could not open its listening port.');
  void shutdown(1);
});
server.listen(config.port, config.host, () => {
  console.log(`ControlDesk: http://${config.host}:${config.port}`);
  console.log('CRM, Tally data and connector configuration share this address.');
  console.log('PostgreSQL connected. Tally connector is READ-ONLY.');
});

let stopping=false;
async function shutdown(exitCode=0) {
  if(stopping)return;stopping=true;
  setTimeout(() => process.exit(1), 5000).unref();
  clearInterval(stalledRunTimer);
  try {const closing=combined.close();await app.close(); await db.close();await closing; process.exit(exitCode);}
  catch { console.error('ControlDesk could not finish shutdown.'); process.exit(1); }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
