import { getConfig } from '../src/config.js';
import { createConnectorStore } from '../src/connector-store.js';
import { parseTallyCompanies } from '../src/tally.js';

const config = getConfig();
// Same read-only company collection used by the unchanged Windows connector.
const body = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>GISCompanies</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="GISCompanies" ISMODIFY="No" ISINITIALIZE="Yes"><TYPE>Company</TYPE><FETCH>NAME,GUID,MASTERID,ALTERID,COMPANYNUMBER,SVCURRENTCOMPANY,REMOTECMPNAME,COMPANYNAME,CURRENTCOMPANY</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>';
console.log(`Checking Tally from this CRM computer at ${config.tallyUrl}`);
try {
  const response = await fetch(config.tallyUrl, { method: 'POST', headers: { 'content-type': 'application/xml; charset=utf-8' }, body, signal: AbortSignal.timeout(config.tallyTimeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const xml = await response.text();
  if (!/<ENVELOPE[\s>]/i.test(xml)) throw new Error('The server did not return a Tally XML envelope.');
  const companies = parseTallyCompanies(xml);
  console.log(`Tally is reachable; ${companies.length} open companies returned.`);
  for (const company of companies) console.log(`Exact company name: ${company.name}`);
  if (!companies.length) console.log('Open the company into Gateway of Tally, enable HTTP access, and verify the connector uses this Tally instance/port. A company listed on the selection screen is not necessarily open.');
} catch (error) { console.log(`Tally check failed: ${error.cause?.code || error.message}`); process.exitCode = 1; }

const store = createConnectorStore(config);
try {
  const { connectors, jobs } = await store.status();
  for (const connector of connectors) console.log(JSON.stringify({ profile: connector.profile_name, company: connector.expected_company_name, connection: connector.connection_state, machine: connector.machine_name, lastSeen: connector.last_seen_at, lastSync: connector.last_sync_at }));
  console.log(`Recent connector sync jobs: ${jobs.length}`);
  for (const job of jobs) console.log(JSON.stringify({ company: job.company_name, status: job.status, message: job.message }));
} finally { await store.close(); }
