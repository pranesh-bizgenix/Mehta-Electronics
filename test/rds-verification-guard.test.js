import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withAuthorizedRdsRollbackVerification} from '../test-support/transaction.js';

test('RDS verification refuses execution without explicit operational opt-in',async()=>{
  const previous=process.env.VERIFY_AUTHORIZED_RDS_ROLLBACK;
  delete process.env.VERIFY_AUTHORIZED_RDS_ROLLBACK;
  try {await assert.rejects(withAuthorizedRdsRollbackVerification(()=>assert.fail('Must not execute')),/opt-in/);}
  finally {if(previous===undefined)delete process.env.VERIFY_AUTHORIZED_RDS_ROLLBACK;else process.env.VERIFY_AUTHORIZED_RDS_ROLLBACK=previous;}
});

test('RDS verification refuses any other endpoint even when explicitly enabled',async()=>{
  const previous=process.env.VERIFY_AUTHORIZED_RDS_ROLLBACK,url=process.env.DATABASE_URL;
  process.env.VERIFY_AUTHORIZED_RDS_ROLLBACK='true';
  process.env.DATABASE_URL='postgresql://unused@127.0.0.1:5432/mehta_electronics_local?sslmode=require';
  try {await assert.rejects(withAuthorizedRdsRollbackVerification(()=>assert.fail('Must not execute')),/unexpected target/);}
  finally {if(previous===undefined)delete process.env.VERIFY_AUTHORIZED_RDS_ROLLBACK;else process.env.VERIFY_AUTHORIZED_RDS_ROLLBACK=previous;if(url===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=url;}
});
