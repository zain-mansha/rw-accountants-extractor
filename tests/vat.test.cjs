const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../dist/core.js');

function profile() {
  return B.newProfile('VAT test driver', '2026-04-06', '2027-04-05');
}

test('VAT return calculates the standard nine boxes from cash transactions', () => {
  const p = profile();
  B.addTransaction(p, { date: '2026-05-01', description: 'Taxi fares', accountId: 'bank', categoryId: 'fares', amount: 12000, vatCode: 'standard-output' });
  B.addTransaction(p, { date: '2026-05-02', description: 'Fuel', accountId: 'bank', categoryId: 'fuel', amount: -6000, vatCode: 'standard-input' });
  B.addTransaction(p, { date: '2026-05-03', description: 'Owner drawings', accountId: 'bank', categoryId: 'drawings', amount: -10000 });

  const result = B.vatReturn(p, { start: '2026-04-06', end: '2027-04-05' });
  assert.deepEqual(
    [result.box1, result.box2, result.box3, result.box4, result.box5, result.box6, result.box7, result.box8, result.box9],
    [2000, 0, 2000, 1000, 1000, 10000, 5000, 0, 0]
  );
  assert.equal(result.lines.length, 2);
});

test('VAT return respects the selected period and VAT code', () => {
  const p = profile();
  B.addTransaction(p, { date: '2026-04-06', description: 'Zero-rated fare', accountId: 'bank', categoryId: 'fares', amount: 5000, vatCode: 'zero-output' });
  B.addTransaction(p, { date: '2026-08-01', description: 'Later fare', accountId: 'bank', categoryId: 'fares', amount: 12000, vatCode: 'standard-output' });
  const result = B.vatReturn(p, { start: '2026-04-06', end: '2026-06-30' });
  assert.equal(result.box1, 0);
  assert.equal(result.box6, 5000);
  assert.equal(result.lines.length, 1);
});

test('VAT settings and draft snapshots are validated and retained', () => {
  const p = profile();
  B.setVatSettings(p, { registered: true, number: 'GB 123 456 789', basis: 'cash', period: 'quarterly' });
  assert.equal(p.vat.number, 'GB123456789');
  const result = B.vatReturn(p, { start: '2026-04-06', end: '2026-06-30' });
  const saved = B.saveVatReturn(p, result);
  assert.equal(saved.status, 'draft');
  assert.equal(p.vatReturns.length, 1);
  const updated = B.saveVatReturn(p, { ...result, box5: 123 });
  assert.equal(updated.id, saved.id);
  assert.equal(updated.version, 2);
  const submitted = B.markVatReturnSubmitted(p, updated.id, { periodKey: 'A1', receiptId: 'F-1' });
  assert.equal(submitted.status, 'submitted');
  assert.equal(submitted.hmrc.receiptId, 'F-1');
  const backup = { version: 1, profiles: [p] };
  assert.doesNotThrow(() => B.validateState(backup));
});

test('accrual VAT uses invoice VAT even when the supplier bill is unpaid', () => {
  const p = profile();
  p.vat.basis = 'accrual';
  p.contacts.push({ id: 'shell', name: 'Shell', type: 'supplier', email: '' });
  B.addInvoice(p, { kind: 'purchase', contactId: 'shell', date: '2026-05-10', due: '2026-06-10', reference: 'SH-1', description: 'Fuel invoice', categoryId: 'fuel', amount: 12000, vat: 2000, vatCode: 'standard-input', businessPercent: 100 });
  const result = B.vatReturn(p, { start: '2026-04-06', end: '2027-04-05' });
  assert.equal(result.box4, 2000);
  assert.equal(result.box7, 10000);
});

