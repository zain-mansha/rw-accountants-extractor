'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const os = require('node:os');

const ENVIRONMENTS = {
  sandbox: {
    authorize: 'https://test-www.tax.service.gov.uk/oauth/authorize',
    token: 'https://test-api.service.hmrc.gov.uk/oauth/token',
    api: 'https://test-api.service.hmrc.gov.uk'
  },
  production: {
    authorize: 'https://www.tax.service.gov.uk/oauth/authorize',
    token: 'https://api.service.hmrc.gov.uk/oauth/token',
    api: 'https://api.service.hmrc.gov.uk'
  }
};

const scopes = ['read:vat', 'write:vat', 'read:self-assessment', 'write:self-assessment'];
const LOCAL_REDIRECT_PORT = 8765;
const base64url = value => Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const random = size => base64url(crypto.randomBytes(size));
const safeEnvironment = value => ENVIRONMENTS[value] ? value : 'sandbox';
const encoded = value => encodeURIComponent(String(value ?? ''));
const platformName = () => process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'MacOS' : 'Linux';

function networkMetadata(deviceId, options = {}) {
  const interfaces = os.networkInterfaces();
  const ips = [];
  const macs = new Set();
  for (const entries of Object.values(interfaces)) for (const item of entries || []) {
    if (item.address) ips.push(item.family === 'IPv6' ? encodeURIComponent(item.address) : item.address);
    if (item.mac && item.mac !== '00:00:00:00:00:00') macs.add(encoded(item.mac.toUpperCase()));
  }
  const username = (() => { try { return os.userInfo().username; } catch { return 'unknown'; } })();
  const window = options.window || { width: 1, height: 1 };
  const screens = options.screens || [{ width: window.width, height: window.height, scalingFactor: 1, colourDepth: 24 }];
  const version = options.appVersion || '1.3.0';
  return {
    'Gov-Client-Connection-Method': 'DESKTOP_APP_DIRECT',
    'Gov-Client-Device-ID': deviceId,
    'Gov-Client-Local-IPs': [...new Set(ips)].join(','),
    'Gov-Client-Local-IPs-Timestamp': new Date().toISOString(),
    'Gov-Client-MAC-Addresses': [...macs].join(','),
    'Gov-Client-Screens': screens.map(item => `width=${Math.max(1, Number(item.width) || 1)}&height=${Math.max(1, Number(item.height) || 1)}&scaling-factor=${Number(item.scalingFactor) > 0 ? Number(item.scalingFactor) : 1}&colour-depth=${Math.max(1, Number(item.colourDepth) || 24)}`).join(','),
    'Gov-Client-Timezone': timezoneOffset(),
    'Gov-Client-User-Agent': `os-family=${encoded(platformName())}&os-version=${encoded(os.release())}&device-manufacturer=${encoded(options.deviceManufacturer || 'Unknown')}&device-model=${encoded(options.deviceModel || os.hostname())}`,
    'Gov-Client-User-IDs': `os=${encoded(username)}`,
    'Gov-Client-Window-Size': `width=${Math.max(1, Number(window.width) || 1)}&height=${Math.max(1, Number(window.height) || 1)}`,
    'Gov-Vendor-Product-Name': encoded('ClearCount'),
    'Gov-Vendor-Public-Name': encoded('ClearCount'),
    'Gov-Vendor-Version': `clearcount=${encoded(version)}`
  };
}

function timezoneOffset() {
  const minutes = -new Date().getTimezoneOffset();
  const sign = minutes >= 0 ? '+' : '-';
  const absolute = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}

async function jsonResponse(response) {
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text.slice(0, 500) }; }
  if (!response.ok) {
    const validation = Array.isArray(body.errors)
      ? body.errors.map(item => [item.path, item.message || item.code].filter(Boolean).join(': ')).filter(Boolean).join('; ')
      : '';
    const code = body.code || body.error || '';
    const message = body.message || body.error_description || '';
    const raw = !code && !message && !validation && text ? text.slice(0, 500) : '';
    const detail = [code, message, validation, raw].filter(Boolean).join(' — ') || `HTTP ${response.status}`;
    const correlation = response.headers.get('x-correlation-id') || response.headers.get('x-request-id');
    const suffix = correlation ? ` (HMRC reference: ${correlation})` : '';
    const guidance = response.status === 400 && /invalid request/i.test(detail)
      ? ' Check that box 3 equals boxes 1+2, box 5 equals the absolute difference between boxes 3 and 4, the period is still open, and the sandbox login is an Organisation VAT test user.'
      : '';
    throw new Error(`HMRC returned ${response.status}: ${detail}${guidance}${suffix}`);
  }
  return body;
}

function createClient({ load, save, deviceId, appVersion = '1.3.0', getDesktopMetadata }) {
  const read = async () => load() || {};
  const write = value => save(value);
  const environmentFor = value => ENVIRONMENTS[safeEnvironment(value)];

  async function refreshIfNeeded(credentials) {
    const now = Date.now();
    if (credentials.accessToken && Number(credentials.expiresAt || 0) > now + 60_000) return credentials;
    if (!credentials.refreshToken) throw new Error('Connect ClearCount to HMRC before requesting data.');
    const environment = safeEnvironment(credentials.environment);
    const response = await fetch(environmentFor(environment).token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_secret: credentials.clientSecret, client_id: credentials.clientId, grant_type: 'refresh_token', refresh_token: credentials.refreshToken })
    });
    const token = await jsonResponse(response);
    const next = { ...credentials, accessToken: token.access_token, refreshToken: token.refresh_token || credentials.refreshToken, expiresAt: now + Number(token.expires_in || 14_400) * 1000 };
    await write(next);
    return next;
  }

  async function apiRequest(path, options = {}) {
    const credentials = await refreshIfNeeded(await read());
    const url = `${environmentFor(credentials.environment).api}${path}`;
    const headers = { Accept: 'application/vnd.hmrc.1.0+json', Authorization: `Bearer ${credentials.accessToken}`, ...networkMetadata(deviceId, { appVersion, ...(getDesktopMetadata?.() || {}) }), ...(options.headers || {}) };
    const response = await fetch(url, { ...options, headers });
    return jsonResponse(response);
  }

  async function authorize({ clientId, clientSecret, environment = 'sandbox', openExternal, onComplete }) {
    if (!clientId?.trim() || !clientSecret?.trim()) throw new Error('Enter the HMRC client ID and client secret first.');
    const env = safeEnvironment(environment), settings = environmentFor(env);
    const state = random(24), verifier = random(48), challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
    const server = http.createServer(async (request, response) => {
      try {
        const url = new URL(request.url, 'http://localhost');
        if (url.pathname !== '/oauth/callback') { response.writeHead(404); response.end('Not found'); return; }
        if (url.searchParams.get('state') !== state) throw new Error('HMRC authorisation state did not match. Start again.');
        const error = url.searchParams.get('error');
        if (error) throw new Error(url.searchParams.get('error_description') || `HMRC authorisation failed: ${error}`);
        const code = url.searchParams.get('code');
        if (!code) throw new Error('HMRC did not return an authorisation code.');
        const redirectUri = `http://localhost:${LOCAL_REDIRECT_PORT}/oauth/callback`;
        const tokenResponse = await fetch(settings.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_secret: clientSecret, client_id: clientId, grant_type: 'authorization_code', redirect_uri: redirectUri, code, code_verifier: verifier }) });
        const token = await jsonResponse(tokenResponse);
        await write({ clientId, clientSecret, environment: env, accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + Number(token.expires_in || 14_400) * 1000, connectedAt: new Date().toISOString() });
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><title>Fare Books</title><p>HMRC is connected. You can close this tab and return to Fare Books.</p>');
        server.close();
        onComplete?.({ ok: true, environment: env });
      } catch (error) {
        response.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        response.end(`<!doctype html><title>Fare Books</title><p>${String(error.message).replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]))}</p>`);
        server.close();
        onComplete?.({ ok: false, error: error.message });
      }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(LOCAL_REDIRECT_PORT, 'localhost', resolve); });
    const redirectUri = `http://localhost:${LOCAL_REDIRECT_PORT}/oauth/callback`;
    const authorization = new URL(settings.authorize);
    authorization.search = new URLSearchParams({ response_type: 'code', client_id: clientId, scope: scopes.join(' '), state, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
    const timeout = setTimeout(() => server.close(), 10 * 60 * 1000); timeout.unref?.();
    try { await openExternal(authorization.toString()); } catch (error) { clearTimeout(timeout); server.close(); throw error; }
    return { environment: env, redirectUri };
  }

  return {
    authorize,
    status: async () => { const value = await read(); return { connected: !!value.refreshToken, environment: value.environment || 'sandbox', clientId: value.clientId || '', expiresAt: value.expiresAt || 0 }; },
    obligations: async ({ vrn, from, to, status = '' }) => {
      if (!/^\d{9}$/.test(String(vrn || ''))) throw new Error('Enter a nine-digit VAT registration number in VAT settings.');
      const query = new URLSearchParams({ from, to }); if (status) query.set('status', status);
      return apiRequest(`/organisations/vat/${encodeURIComponent(vrn)}/obligations?${query}`);
    },
    submit: async ({ vrn, periodKey, values }) => {
      if (!/^\d{9}$/.test(String(vrn || ''))) throw new Error('Enter a nine-digit VAT registration number in VAT settings.');
      if (!periodKey) throw new Error('Choose an open HMRC obligation period.');
      if (!values || typeof values !== 'object') throw new Error('Save a VAT draft before submitting it to HMRC.');
      const money = value => Number((Math.max(0, Number(value) || 0) / 100).toFixed(2));
      const vatDueSales = money(values.box1), vatDueAcquisitions = money(values.box2);
      const totalVatDue = Number((vatDueSales + vatDueAcquisitions).toFixed(2));
      const vatReclaimedCurrPeriod = money(values.box4);
      // HMRC requires box 5 (netVatDue) as a positive monetary amount even when the return is a repayment.
      const netVatDue = Number(Math.abs(totalVatDue - vatReclaimedCurrPeriod).toFixed(2));
      const body = { periodKey, vatDueSales, vatDueAcquisitions, totalVatDue, vatReclaimedCurrPeriod, netVatDue, totalValueSalesExVAT: money(values.box6), totalValuePurchasesExVAT: money(values.box7), totalValueGoodsSuppliedExVAT: money(values.box8), totalAcquisitionsExVAT: money(values.box9), finalised: true };
      return apiRequest(`/organisations/vat/${encodeURIComponent(vrn)}/returns`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    },
    itsaBusinesses: async ({ nino }) => {
      const value = String(nino || '').replace(/\s+/g, '').toUpperCase();
      if (!/^[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]$/.test(value)) throw new Error('Enter a valid National Insurance number.');
      return apiRequest(`/individuals/business/details/${encodeURIComponent(value)}/list`, { headers: { Accept: 'application/vnd.hmrc.2.0+json' } });
    },
    itsaBusiness: async ({ nino, businessId }) => {
      const value = String(nino || '').replace(/\s+/g, '').toUpperCase();
      if (!/^[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]$/.test(value)) throw new Error('Enter a valid National Insurance number.');
      if (!String(businessId || '').trim()) throw new Error('Choose an HMRC business before requesting its details.');
      return apiRequest(`/individuals/business/details/${encodeURIComponent(value)}/${encodeURIComponent(String(businessId).trim())}`, { headers: { Accept: 'application/vnd.hmrc.2.0+json' } });
    },
    itsaObligations: async ({ nino, from, to, status = 'open', businessId = '' }) => {
      const value = String(nino || '').replace(/\s+/g, '').toUpperCase();
      if (!/^[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]$/.test(value)) throw new Error('Enter a valid National Insurance number.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(to || ''))) throw new Error('Income Tax obligation dates must use YYYY-MM-DD.');
      const query = new URLSearchParams({ fromDate: from, toDate: to });
      if (status) query.set('status', status);
      if (businessId) query.set('businessId', String(businessId).trim());
      return apiRequest(`/obligations/details/${encodeURIComponent(value)}/income-and-expenditure?${query}`, { headers: { Accept: 'application/vnd.hmrc.3.0+json' } });
    },
    itsaSelfEmploymentCumulative: async ({ nino, businessId, taxYear, body }) => {
      const value = String(nino || '').replace(/\s+/g, '').toUpperCase();
      if (!/^[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]$/.test(value)) throw new Error('Enter a valid National Insurance number.');
      if (!String(businessId || '').trim()) throw new Error('Choose an HMRC self-employment business.');
      if (!/^\d{4}-\d{2}$/.test(String(taxYear || ''))) throw new Error('Income Tax tax year must use YYYY-YY.');
      if (!body || typeof body !== 'object' || !body.periodDates || !body.periodIncome || !body.periodExpenses) throw new Error('Income Tax submission needs period dates, income, and expenses.');
      return apiRequest(`/individuals/business/self-employment/${encodeURIComponent(value)}/${encodeURIComponent(String(businessId).trim())}/cumulative/${encodeURIComponent(taxYear)}`, { method: 'PUT', headers: { Accept: 'application/vnd.hmrc.5.0+json', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    },
    itsaCalculation: async ({ nino, taxYear, type = 'in-year' }) => {
      const value = String(nino || '').replace(/\s+/g, '').toUpperCase();
      if (!/^[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]$/.test(value)) throw new Error('Enter a valid National Insurance number.');
      if (!/^\d{4}-\d{2}$/.test(String(taxYear || ''))) throw new Error('Income Tax tax year must use YYYY-YY.');
      if (!['in-year', 'intent-to-finalise'].includes(type)) throw new Error('Choose an Income Tax calculation type.');
      return apiRequest(`/individuals/calculations/${encodeURIComponent(value)}/self-assessment/${encodeURIComponent(taxYear)}/trigger/${type}`, { method: 'POST', headers: { Accept: 'application/vnd.hmrc.9.0+json', 'content-type': 'application/json' }, body: '{}' });
    }
  };
}

module.exports = { ENVIRONMENTS, LOCAL_REDIRECT_PORT, networkMetadata, createClient };
