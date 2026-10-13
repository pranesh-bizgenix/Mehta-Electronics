import http from 'node:http';
import { createApp } from './app.js';
import { getConfig } from './config.js';
import { openDatabase } from './db.js';

const config = getConfig();
const db = openDatabase(config);
const server = http.createServer(createApp({ db, config }));

server.listen(config.port, config.host, () => {
  console.log(`Mehta CRM listening on http://${config.host}:${config.port}`);
  console.log('Phase 1 only. Tally connector is READ-ONLY.');
});

function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
