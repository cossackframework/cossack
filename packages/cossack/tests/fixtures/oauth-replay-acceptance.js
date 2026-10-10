import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { expect } from 'vitest';

const privateValue = 'PRIVATE_NATIVE_OAUTH_TOKEN_CODE_VERIFIER_DATABASE';

// Loopback-only provider deliberately accepts repeated codes. The app's state
// store must stop replay before this provider or application mapping runs.
export async function createOAuthFixtureProvider() {
  const exchanges = [];
  const profiles = [];
  const server = http.createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/token') {
      let body = ''; for await (const chunk of request) body += chunk;
      const fields = new URLSearchParams(body);
      const code = fields.get('code');
      exchanges.push({ code, verifier: fields.get('code_verifier'), redirect: fields.get('redirect_uri') });
      if (code === 'exchange-fail') { response.writeHead(401); response.end(JSON.stringify({ error: privateValue })); return; }
      response.end(JSON.stringify({ access_token: privateValue + ':' + code })); return;
    }
    if (request.url === '/user') {
      const mode = request.headers.authorization?.split(':').at(-1);
      profiles.push(mode);
      response.end(JSON.stringify({ id: 'native-oauth-' + mode, email: 'native-oauth-' + mode + '@example.invalid',
        mappingFailure: mode === 'mapping-fail' })); return;
    }
    response.writeHead(404); response.end('{}');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { origin: 'http://127.0.0.1:' + server.address().port, exchanges, profiles,
    close: () => new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }) };
}

export async function writeOAuthReplayAcceptance(root, providerOrigin) {
  const directory = path.join(root, 'src/pages/api');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'oauth-contract.ts'), `
import { createOAuth, defineOAuthProvider } from '@cossackframework/auth';
import { defineApi } from '@cossackframework/framework/api';
import { oauthStateStore, handleOAuthUser } from '../../auth';
import { User } from '../../models/User';
import { Session } from '../../models/Session';
import { OAuthAccount } from '../../models/OAuthAccount';

const origin = ${JSON.stringify(providerOrigin)};
const definition = defineOAuthProvider({ id: 'fixture', authorizeUrl: origin + '/authorize',
  tokenUrl: origin + '/token', userInfoUrl: origin + '/user', scopes: [],
  normalizeUser: raw => ({ id: String(raw.id), email: String(raw.email), raw }) });
export const GET = defineApi({ handler: async ({ c }) => {
  const phase = c.req.query('phase');
  if (phase === 'expire' || phase === 'purpose') {
    const key = c.req.query('key')!;
    await Session.update({ id: key }, phase === 'expire' ? { expiresAt: new Date(0) } : { meta: { type: 'password_reset' } });
    return c.json({ accepted: true });
  }
  if (phase === 'summary') {
    const user = await User.findOne({ where: { email: 'native-oauth-success@example.invalid' } });
    return c.json({ accounts: await OAuthAccount.count({ provider: 'fixture' }),
      sessions: user ? await Session.count({ userId: user.id }) : 0 });
  }
  const provider = { clientId: 'fixture', clientSecret: '${privateValue}', redirectUrl: '/api/oauth-contract?phase=callback' };
  const oauth = createOAuth({ secret: String(c.env.OAUTH_SECRET), stateStore: oauthStateStore,
    providers: { fixture: provider, other: provider },
    customProviders: { fixture: definition, other: { ...definition, id: 'other' } } });
  const selected = c.req.query('provider') === 'other' ? 'other' : 'fixture';
  const handler = phase === 'redirect' ? oauth.redirect(selected) : oauth.callback(selected, {
    async onUser(user, tokens, context) {
      if (user.raw.mappingFailure) throw new Error('${privateValue}');
      return handleOAuthUser('fixture', user, tokens, context);
    },
  });
  const response = await handler(c, async () => {});
  if (!(response instanceof Response)) throw new Error('The fixture requires an OAuth response');
  return response;
} });
`);
}

export async function checkOAuthReplay(request, provider) {
  const begin = async code => {
    const response = await request('/api/oauth-contract?phase=redirect');
    expect(response.status, await response.clone().text()).toBe(302);
    const authorization = new URL(response.headers.get('location'));
    const state = authorization.searchParams.get('state');
    const challenge = authorization.searchParams.get('code_challenge');
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const key = createHash('sha256').update(JSON.stringify(['cossack-oauth-state', 'fixture', state])).digest('hex');
    const callback = extra => request('/api/oauth-contract?phase=callback&code=' + code + '&state=' + state + (extra ?? ''), { headers: { cookie } });
    return { callback, key, challenge };
  };
  const safeDiagnostic = async (response, code, stage, status) => {
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body).toMatchObject({ code, stage, status });
    expect(JSON.stringify(body)).not.toContain(privateValue);
    expect(response.headers.get('set-cookie')).toMatch(/cossack_oauth_state=;.*Max-Age=0/i);
  };
  const success = await begin('success');
  const outcomes = await Promise.all([success.callback(), success.callback()]);
  expect(outcomes.map(response => response.status).sort()).toEqual([302, 400]);
  const winner = outcomes.find(response => response.status === 302);
  expect(winner.headers.get('set-cookie')).toMatch(/session_id=[0-9a-f]{64};.*HttpOnly/);
  await safeDiagnostic(outcomes.find(response => response.status === 400), 'COSSACK_OAUTH_STATE_UNAVAILABLE', 'state', 400);
  await safeDiagnostic(await success.callback(), 'COSSACK_OAUTH_STATE_UNAVAILABLE', 'state', 400);
  expect(provider.exchanges.filter(row => row.code === 'success')).toHaveLength(1);
  expect(provider.profiles.filter(mode => mode === 'success')).toHaveLength(1);
  const exchange = provider.exchanges.find(row => row.code === 'success');
  expect(createHash('sha256').update(exchange.verifier).digest('base64url')).toBe(success.challenge);
  expect(exchange.redirect).toContain('/api/oauth-contract?phase=callback');
  expect(await (await request('/api/oauth-contract?phase=summary')).json()).toEqual({ accounts: 1, sessions: 1 });

  for (const [mode, code, stage, status] of [
    ['exchange-fail', 'COSSACK_OAUTH_TOKEN_EXCHANGE_FAILED', 'token-exchange', 502],
    ['mapping-fail', 'COSSACK_OAUTH_ACCOUNT_MAPPING_FAILED', 'account-mapping', 500],
  ]) {
    const flow = await begin(mode);
    await safeDiagnostic(await flow.callback(), code, stage, status);
    await safeDiagnostic(await flow.callback(), 'COSSACK_OAUTH_STATE_UNAVAILABLE', 'state', 400);
    expect(provider.exchanges.filter(row => row.code === mode)).toHaveLength(1);
    expect(provider.profiles.filter(value => value === mode)).toHaveLength(mode === 'exchange-fail' ? 0 : 1);
  }
  const bound = await begin('bound');
  await safeDiagnostic(await bound.callback('&provider=other'), 'COSSACK_OAUTH_STATE_UNAVAILABLE', 'state', 400);
  expect(provider.exchanges.some(row => row.code === 'bound')).toBe(false);
  // Test purpose and database expiry independently of the signed cookie lifetime.
  for (const phase of ['expire', 'purpose']) {
    const flow = await begin(phase);
    expect((await request('/api/oauth-contract?phase=' + phase + '&key=' + flow.key)).status).toBe(200);
    await safeDiagnostic(await flow.callback(), 'COSSACK_OAUTH_STATE_UNAVAILABLE', 'state', 400);
    expect(provider.exchanges.some(row => row.code === phase)).toBe(false);
  }
  expect(await (await request('/api/oauth-contract?phase=summary')).json()).toEqual({ accounts: 1, sessions: 1 });
}
