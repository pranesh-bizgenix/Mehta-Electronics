import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { createApp } from '../../../src/app.js';
import { getConfig } from '../../../src/config.js';
import { openDatabase } from '../../../src/db.js';

let db;
let server;
let baseUrl;

before(async () => {
  db = openDatabase(getConfig({ databasePath: ':memory:', seedOwnerEmail: 'web-test@example.invalid', seedOwnerPassword: 'TestPass123!Secure' }));
  server = http.createServer(createApp({ db, config: getConfig({ databasePath: ':memory:' }) }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  db?.close();
});

test('existing GET /api/auth/me endpoint returns its documented unauthenticated response', async () => {
  const response = await fetch(`${baseUrl}/api/auth/me`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Authentication required.' });
});
