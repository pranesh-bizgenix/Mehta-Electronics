import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatMoney, formatMoneyCompact, formatQty, formatPercent, groupIndian, titleCase } from '../lib/format.ts';

test('money uses Indian grouping, exact decimal rounding and no floats', () => {
  assert.equal(groupIndian('1234567'), '12,34,567');
  assert.equal(formatMoney('1234567'), '₹12,34,567.00');
  assert.equal(formatMoney('350000.000000'), '₹3,50,000.00');
  assert.equal(formatMoney('99999999999999.995'), '₹10,00,00,00,00,00,000.00');
  assert.equal(formatMoney('0.005'), '₹0.01');
  assert.equal(formatMoney('-98765.432'), '−₹98,765.43');
  assert.equal(formatMoney('-0.001'), '₹0.00');
  assert.equal(formatMoney(null), '—');
  assert.equal(formatMoney('abc'), '—');
  assert.equal(formatMoneyCompact('1840000'), '₹18.40 L');
  assert.equal(formatMoneyCompact('45000000'), '₹4.50 Cr');
});

test('quantities trim trailing zeros and keep units; labels keep acronyms', () => {
  assert.equal(formatQty('1200.500', 'NOS'), '1,200.5 NOS');
  assert.equal(formatQty('12.000000'), '12');
  assert.equal(formatPercent('12.345'), '12.3%');
  assert.equal(titleCase('ENROLMENT_STARTED'), 'Enrolment started');
  assert.equal(titleCase('MFA'), 'MFA');
  assert.equal(titleCase('SLA_BREACHED'), 'SLA breached');
});
