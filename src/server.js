import http from 'node:http';
import { createApp } from './app.js';
import { getConfig } from './config.js';
import { openDatabase } from './db.js';
import { markStalledRuns } from './tally-import.js';

const config = getConfig();
const db = (await openDatabase(config));
const app = createApp({ db, config });
const server = http.createServer(app);
const stalledRunTimer=setInterval(()=>markStalledRuns(db.sql,config.tallyStalledRunMinutes).catch(error=>console.error('Stalled-run maintenance failed:',error.code||error.name)),30_000);
stalledRunTimer.unref();

server.listen(config.port, config.host, () => {
  console.log(`Mehta CRM listening on http://${config.host}:${config.port}`);
  console.log('PostgreSQL connected. Tally connector is READ-ONLY.');
});

function shutdown() {
  clearInterval(stalledRunTimer);
  server.close(async () => {
    try { await app.close(); await db.close(); process.exit(0); }
    catch (error) { console.error(error); process.exit(1); }
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
