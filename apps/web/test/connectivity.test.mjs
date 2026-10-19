import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { createApp } from '../../../src/app.js';
import { getConfig } from '../../../src/config.js';
import { openDatabase } from '../../../src/db.js';
import { temporaryDatabase } from '../../../test-support/postgres.js';

let db;
let server;
let baseUrl;
let app;
let temporary;

before(async () => {
  temporary = await temporaryDatabase();
  const config = getConfig({ databaseUrl: temporary.databaseUrl, seedOwnerEmail: 'web-test@example.invalid', seedOwnerPassword: 'TestPass123!Secure' });
  db = await openDatabase(config);
  app = createApp({ db, config });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (app) await app.close();
  if (db) await db.close();
  if (temporary) await temporary.close();
});

test('existing GET /api/auth/me endpoint returns its documented unauthenticated response', async () => {
  const response = await fetch(`${baseUrl}/api/auth/me`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Authentication required.' });
});
