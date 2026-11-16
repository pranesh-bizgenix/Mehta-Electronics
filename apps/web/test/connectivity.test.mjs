import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../../../src/app.js';
import { getConfig } from '../../../src/config.js';
import { openTestTransactionScope } from '../../../test-support/transaction.js';
import { testFetch } from '../../../test-support/http-client.js';

let db;
let fetch;
let app;
let temporary;

before(async () => {
  temporary = await openTestTransactionScope();
  db = temporary.db;
  const config = getConfig({ localReviewAccess: false });
  app = createApp({ db, config });
  fetch = testFetch(app);
});

after(async () => {
  if (app) await app.close();
  if (temporary) await temporary.close();
});

test('existing GET /api/auth/me endpoint returns its documented unauthenticated response', async () => {
  const response = await fetch('/api/auth/me');
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Authentication required.', code: 'UNAUTHENTICATED' });
});
