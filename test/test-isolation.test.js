import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertTestSchema, temporarySchema, temporaryDatabase, shadowPublicRelations } from '../test-support/postgres.js';
test('legacy schema-per-test entry points refuse without opening a database', async () => {
  assert.throws(() => assertTestSchema('public'), { code: 'TEST_SCHEMA_DISABLED' });
  for (const fn of [temporarySchema, temporaryDatabase, shadowPublicRelations]) await assert.rejects(fn(), { code: 'TEST_SCHEMA_DISABLED' });
});
