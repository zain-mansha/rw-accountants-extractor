const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, networkMetadata, LOCAL_REDIRECT_PORT } = require('../desktop/hmrc.cjs');

test('HMRC desktop fraud headers include a persistent device identity and current network metadata', () => {
  const headers = networkMetadata('device-test');
  assert.equal(headers['Gov-Client-Connection-Method'], 'DESKTOP_APP_DIRECT');
  assert.equal(headers['Gov-Client-Device-ID'], 'device-test');
  assert.match(headers['Gov-Client-Local-IPs-Timestamp'], /^\d{4}-\d{2}-\d{2}T/);
  assert.match(headers['Gov-Client-Timezone'], /^UTC[+-]\d{2}:\d{2}$/);
  assert.match(headers['Gov-Client-Screens'], /width=\d+&height=\d+/);
  assert.match(headers['Gov-Client-User-Agent'], /os-family=/);
  assert.match(headers['Gov-Client-Window-Size'], /width=\d+&height=\d+/);
  assert.equal(headers['Gov-Vendor-Product-Name'], 'ClearCount');
  assert.match(headers['Gov-Vendor-Version'], /^clearcount=/);
  assert.equal(LOCAL_REDIRECT_PORT, 8765);
});

test('HMRC client retrieves obligations and maps a VAT draft to the nine-box API payload', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ obligations: [{ periodKey: 'A1', status: 'O' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const client = createClient({
      load: async () => ({ environment: 'sandbox', clientId: 'id', clientSecret: 'secret', accessToken: 'token', expiresAt: Date.now() + 60 * 60 * 1000, refreshToken: 'refresh' }),
      save: async () => {},
      deviceId: 'device-test'
    });
    const obligations = await client.obligations({ vrn: '123456789', from: '2026-04-06', to: '2027-04-05' });
    assert.equal(obligations.obligations[0].periodKey, 'A1');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer token');
    const result = await client.submit({ vrn: '123456789', periodKey: 'A1', values: { box1: 2000, box2: 0, box3: 2000, box4: 1000, box5: 1000, box6: 10000, box7: 5000, box8: 0, box9: 0 } });
    assert.equal(result.obligations[0].status, 'O');
    const submitted = JSON.parse(calls[1].options.body);
    assert.deepEqual(submitted, { periodKey: 'A1', vatDueSales: 20, vatDueAcquisitions: 0, totalVatDue: 20, vatReclaimedCurrPeriod: 10, netVatDue: 10, totalValueSalesExVAT: 100, totalValuePurchasesExVAT: 50, totalValueGoodsSuppliedExVAT: 0, totalAcquisitionsExVAT: 0, finalised: true });
  } finally {
    global.fetch = originalFetch;
  }
});

test('HMRC VAT submission sends a positive box 5 amount when the return is a repayment', async () => {
  let request;
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    request = { url: String(url), options };
    return new Response(JSON.stringify({ receiptId: 'R-1' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const client = createClient({
      load: async () => ({ environment: 'sandbox', clientId: 'id', clientSecret: 'secret', accessToken: 'token', expiresAt: Date.now() + 60 * 60 * 1000, refreshToken: 'refresh' }),
      save: async () => {},
      deviceId: 'device-test'
    });
    await client.submit({ vrn: '123456789', periodKey: 'A1', values: { box1: 1000, box2: 0, box3: 1000, box4: 2500, box5: -1500, box6: 5000, box7: 12000, box8: 0, box9: 0 } });
    const submitted = JSON.parse(request.options.body);
    assert.equal(submitted.totalVatDue, 10);
    assert.equal(submitted.netVatDue, 15);
  } finally {
    global.fetch = originalFetch;
  }
});

test('HMRC submission errors preserve validation details and correlation references', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    code: 'INVALID_REQUEST',
    message: 'The return is invalid',
    errors: [{ path: 'netVatDue', message: 'must equal the calculated net VAT' }]
  }), { status: 400, headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-123' } });
  try {
    const client = createClient({
      load: async () => ({ environment: 'sandbox', clientId: 'id', clientSecret: 'secret', accessToken: 'token', expiresAt: Date.now() + 60 * 60 * 1000, refreshToken: 'refresh' }),
      save: async () => {},
      deviceId: 'device-test'
    });
    await assert.rejects(
      client.submit({ vrn: '123456789', periodKey: 'A1', values: { box1: 2000, box2: 0, box4: 1000 } }),
      /HMRC returned 400: INVALID_REQUEST — The return is invalid — netVatDue: must equal the calculated net VAT \(HMRC reference: corr-123\)/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('HMRC Income Tax client lists businesses, obligations, cumulative updates, and calculations', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const body = String(url).includes('/list')
      ? { listOfBusinesses: [{ businessId: 'XBIS12345678901', typeOfBusiness: 'self-employment', tradingName: 'ClearCount Test Trade' }] }
      : String(url).includes('/income-and-expenditure')
        ? { obligations: [{ typeOfBusiness: 'self-employment', businessId: 'XBIS12345678901', obligationDetails: [{ periodStartDate: '2026-04-06', periodEndDate: '2026-07-05', dueDate: '2026-08-07', status: 'Open' }] }] }
        : String(url).includes('/trigger/')
          ? { calculationId: 'CALC123' }
          : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const client = createClient({
      load: async () => ({ environment: 'sandbox', clientId: 'id', clientSecret: 'secret', accessToken: 'token', expiresAt: Date.now() + 60 * 60 * 1000, refreshToken: 'refresh' }),
      save: async () => {},
      deviceId: 'device-test'
    });
    const businesses = await client.itsaBusinesses({ nino: 'LY397751B' });
    assert.equal(businesses.listOfBusinesses[0].businessId, 'XBIS12345678901');
    const obligations = await client.itsaObligations({ nino: 'LY397751B', from: '2026-04-06', to: '2027-04-05' });
    assert.equal(obligations.obligations[0].obligationDetails[0].status, 'Open');
    await client.itsaSelfEmploymentCumulative({
      nino: 'LY397751B', businessId: 'XBIS12345678901', taxYear: '2026-27',
      body: { periodDates: { periodStartDate: '2026-04-06', periodEndDate: '2026-07-05' }, periodIncome: { turnover: 12000 }, periodExpenses: { consolidatedExpenses: 3000 } }
    });
    const calculation = await client.itsaCalculation({ nino: 'LY397751B', taxYear: '2026-27', type: 'in-year' });
    assert.equal(calculation.calculationId, 'CALC123');
    assert.match(calls[0].url, /individuals\/business\/details\/LY397751B\/list$/);
    assert.equal(calls[0].options.headers.Accept, 'application/vnd.hmrc.2.0+json');
    assert.match(calls[1].url, /obligations\/details\/LY397751B\/income-and-expenditure/);
    assert.equal(calls[2].options.method, 'PUT');
    assert.match(calls[2].url, /cumulative\/2026-27$/);
    assert.equal(calls[3].options.method, 'POST');
    assert.match(calls[3].url, /trigger\/in-year$/);
  } finally {
    global.fetch = originalFetch;
  }
});

