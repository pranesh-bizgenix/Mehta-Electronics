import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withTestTransaction} from '../test-support/transaction.js';
import {writeFixture,insertWriteJob} from '../test-support/tally-write-fixture.js';
import {transaction} from '../src/crm-modules.js';
test('isolated write outbox audits creation/transitions, enforces maker-checker and forbids mutation/deletion of retained evidence',()=>withTestTransaction(async db=>{
  const f=await writeFixture(db);
  await transaction(db,f.maker,'VERIFY- write outbox integrity',async()=>{
    const row=await insertWriteJob(db,f);
    assert.equal(row.dry_run,true);assert.equal(row.status,'PENDING');
    const [event]=await db.sql`SELECT outbox_id FROM tw_outbox_events WHERE outbox_id=${row.id} AND next_status='PENDING'`;
    assert.ok(event,'The creation event must reference the actual inserted outbox row.');
    await assert.rejects(db.sql`UPDATE tw_outbox SET payload_xml='<ENVELOPE><CHANGED/></ENVELOPE>' WHERE id=${row.id}`,/snapshot is immutable/);
    await assert.rejects(db.sql`UPDATE tw_outbox SET approved_by=${f.maker.id},approved_at=now(),status='APPROVED' WHERE id=${row.id}`,{code:'23514'});
    await assert.rejects(db.sql`DELETE FROM tw_outbox WHERE id=${row.id}`,/forbidden/);
    await assert.rejects(db.sql`UPDATE tw_mapping_versions SET configuration='{"changed":true}' WHERE id=${f.mapping}`,/append-only/);
    await assert.rejects(db.sql`UPDATE tw_outbox_events SET reason='VERIFY- changed' WHERE outbox_id=${row.id}`,/append-only/);
  });
}));
