import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTallyCompanies, parseTallyCustomers, parseTallyItems } from '../src/tally.js';
import { connectorConnectionState } from '../src/connector-store.js';

test('reads Tally company and master names from XML attributes without a NAME child', () => {
  const companies=parseTallyCompanies('<ENVELOPE><COMPANY NAME="MEHTA ELECTRIC CORPORATION - (from 1-Apr-23)"><GUID>company-1</GUID></COMPANY></ENVELOPE>');
  assert.equal(companies[0].name,'MEHTA ELECTRIC CORPORATION - (from 1-Apr-23)');
  const customers=parseTallyCustomers('<LEDGER NAME="O\'Brien &amp; Sons"><GUID>ledger-1</GUID><LEDGERPHONE>9876543210</LEDGERPHONE></LEDGER>');
  assert.equal(customers[0].name,"O'Brien & Sons");
  assert.equal(customers[0].phone,'9876543210');
  const items=parseTallyItems('<STOCKITEM NAME="3RT2026"><GUID>stock-1</GUID><BASEUNITS>NOS</BASEUNITS></STOCKITEM>');
  assert.equal(items[0].partCode,'3RT2026');
  assert.equal(items[0].uom,'NOS');
});

test('distinguishes an unused setup from a paired connector and a Tally connection without companies', () => {
  const now=Date.parse('2026-10-19T12:00:00Z');
  const pending={status:'active',last_seen_at:null,pairing_expires_at:new Date(now+60000)};
  assert.equal(connectorConnectionState(pending,now),'awaiting_pairing');
  assert.equal(connectorConnectionState(pending,now+120000),'pairing_expired');
  assert.equal(connectorConnectionState({status:'active',last_seen_at:null},now),'awaiting_connection');
  assert.equal(connectorConnectionState({status:'active',last_seen_at:new Date(now),tally_available:true,selected_company:null},now),'awaiting_company');
  assert.equal(connectorConnectionState({status:'active',last_seen_at:new Date(now),tally_available:false},now),'tally_unavailable');
});
