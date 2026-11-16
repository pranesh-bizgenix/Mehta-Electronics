import crypto from 'node:crypto';
export async function tallyFixture(db, name = 'ZZTEST_Mehta') {
  const company = crypto.randomUUID(), connector = crypto.randomUUID(), session = crypto.randomUUID();
  await db.sql`INSERT INTO tally_companies(id,name) VALUES(${company},${name})`;
  await db.sql`INSERT INTO tally_connectors(id,profile_name,expected_company_name,token_hash) VALUES(${connector},'ZZTEST_connector',${name},${crypto.randomUUID()})`;
  await db.sql`INSERT INTO tally_upload_sessions(id,connector_id,company_name,sync_from,sync_to,status) VALUES(${session},${connector},${name},'2026-01-01','2026-12-31','stored')`;
  const insert = async (table, values) => {
    if (!['tally_groups','tally_ledgers','tally_stock_items'].includes(table)) throw new Error('Invalid source fixture table.');
    const row = { company_id: company, session_id: session, source_key: values.id, raw_record: '{}', ...values };
    if (table === 'tally_stock_items') row.normalized_part_number = values.name;
    const columns = Object.keys(row);
    await db.sql.unsafe(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row));
  };
  return { company, connector, session, insert };
}
