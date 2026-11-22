// Two-step sign-in and sign-in limits of the dashboard package, on the ORM: the same flow on
// SQLite and on a RomeDB file.
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { cleanupRoots, project, cossack, vite, productionServer, routeId as servedRouteId } from './fixtures/generated-app.js';
import { browserless } from './fixtures/cms-client.js';
import { totpCode, totpStep } from '../../auth/src/two-factor.ts';

afterEach(cleanupRoots);

const PAGES = ['auth/register/index.ts', 'auth/login/index.ts', 'auth/two-factor/index.ts', 'dashboard/profile/security/index.ts',
  'auth/setup/index.ts', 'auth/verify/index.ts', 'auth/magic/index.ts', 'dashboard/users/registrations/index.ts'];
const account = { email: 'ada@example.test', password: 'test-password-123' };

async function accountSecurity(database) {
  const root = await project('node', ['dashboard'], { database });
  // SQLite takes its migrations from the command; a RomeDB project applies them itself.
  if (database === 'sqlite') await cossack(root, ['migration', 'up', '--json']);
  await vite(root, []);
  await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8'));
  const routeIds = Object.fromEntries(PAGES.map(page => [`/src/pages/${page}`, servedRouteId(manifest, `/src/pages/${page}`)]));
  const server = await productionServer(root, { APP_SECRET: 'generated-account-security-test-secret' });
  try {
    const { origin } = server;
    const client = () => browserless(origin, routeIds, server.diagnostics);
    const [login, twoFactor, security] = ['auth/login/index.ts', 'auth/two-factor/index.ts', 'dashboard/profile/security/index.ts'];

    const owner = client();
    await owner.action('auth/register/index.ts', 'register', [{ name: 'Ada', ...account }]);
    expect(owner.jar.has('session_id')).toBe(true);

    // An authenticator app: the setup gives a secret, and a code from it confirms it.
    const setup = await owner.action(security, 'beginSetup', []);
    expect(setup.error).toBe('');
    // The same code is tried again below, so it is made once: a code made later could belong to the next 30 seconds.
    const usedCode = await totpCode(setup.setup.secret, totpStep(Date.now()));
    const confirmed = await owner.action(security, 'finishSetup', [usedCode]);
    expect(confirmed.error).toBe('');
    expect(confirmed.recoveryCodes).toHaveLength(10);
    expect(confirmed.status).toMatchObject({ totp: true, recoveryCodes: 10 });

    // The password only starts the sign-in now.
    const visitor = client();
    expect((await visitor.action(login, 'login', [account]))._cossack_redirect).toBe('/auth/two-factor');
    expect([visitor.jar.has('session_id'), visitor.jar.has('two_factor')]).toEqual([false, true]);
    expect((await visitor.action(twoFactor, 'verify', ['000000'])).error).toContain('4 tries left');
    // The code that confirmed the setup was used: it does not work a second time.
    expect((await visitor.action(twoFactor, 'verify', [usedCode])).error).toContain('tries left');
    const verified = await visitor.action(twoFactor, 'verify', [confirmed.recoveryCodes[0]]);
    expect(verified._cossack_redirect).toBe('/dashboard/profile/security?recovered=1');
    expect(visitor.jar.has('session_id')).toBe(true);
    // A recovery code works once.
    const again = client();
    await again.action(login, 'login', [account]);
    expect((await again.action(twoFactor, 'verify', [confirmed.recoveryCodes[0]])).error).toContain('tries left');

    // An application password is shown once, listed without its secret, and can be deleted.
    const added = await owner.action(security, 'addToken', ['Deploy script', 'read', 30]);
    expect(added.newToken).toMatch(/^app_[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}$/);
    expect(added.tokens).toMatchObject([{ name: 'Deploy script', scope: 'read', lastUsedAt: null }]);
    expect(JSON.stringify(added.tokens)).not.toContain(added.newToken.split('.')[1]);
    expect((await owner.action(security, 'deleteToken', [added.tokens[0].id])).tokens).toEqual([]);

    // Turning it off needs a code; then the password signs in at once.
    const off = await owner.action(security, 'turnOff', [confirmed.recoveryCodes[1]]);
    expect(off.error).toBe('');
    expect(off.status.totp).toBe(false);
    const plain = client();
    expect((await plain.action(login, 'login', [account]))._cossack_redirect).not.toBe('/auth/two-factor');
    expect(plain.jar.has('session_id')).toBe(true);

    // Five wrong passwords for an email: the sixth sign-in is refused, with the right one too.
    const guesser = client();
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await guesser.action(login, 'login', [{ email: 'grace@example.test', password: 'wrong-password-123' }])).error).toBe('Invalid credentials');
    }
    expect((await guesser.action(login, 'login', [{ email: 'grace@example.test', password: 'wrong-password-123' }])).error).toMatch(/^Too many sign-in attempts\. Try again in \d+ minutes\.$/);
    // Another email from the same address still signs in.
    expect((await client().action(login, 'login', [account])).error ?? '').not.toContain('Too many');
  } finally { await server.close(); }
}

it('keeps second factors and sign-in limits on SQLite', () => accountSecurity('sqlite'), 300000);
it('keeps second factors and sign-in limits on a RomeDB file', () => accountSecurity('romedb'), 300000);

/** The first account through /auth/setup, then a registration that confirms its email, waits for approval, and signs in with a link. */
async function registration(database) {
  const root = await project('node', ['dashboard'], { database });
  // The project asks for both steps, and its emails go to a file.
  const configFile = path.join(root, 'src/dashboard.config.ts');
  await fs.writeFile(configFile, (await fs.readFile(configFile, 'utf8')).replace('export const dashboard: DashboardConfig = {',
    "export const dashboard: DashboardConfig = {\n  registration: { verifyEmail: true, approve: true, defaultRole: 'admin' },"));
  const entryFile = path.join(root, 'src/index.ts');
  const entry = await fs.readFile(entryFile, 'utf8');
  const mailbox = "import { appendFileSync } from 'node:fs';\nconst mailbox = { send: async (message: unknown) => { appendFileSync('mails.jsonl', JSON.stringify(message) + '\\n'); } };\n";
  await fs.writeFile(entryFile, mailbox + (entry.includes('bindings: variables => ({')
    ? entry.replace('bindings: variables => ({', 'bindings: variables => ({ EMAIL: mailbox,')
    : entry.replace('  dev: import.meta.env?.DEV,', '  dev: import.meta.env?.DEV,\n  bindings: () => ({ EMAIL: mailbox }),')));
  if (database === 'sqlite') await cossack(root, ['migration', 'up', '--json']);
  await vite(root, []);
  await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8'));
  const routeIds = Object.fromEntries(PAGES.map(page => [`/src/pages/${page}`, servedRouteId(manifest, `/src/pages/${page}`)]));
  const mails = async () => (await fs.readFile(path.join(root, 'mails.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  const tokenOf = mail => /token=([A-Za-z0-9_-]+)/.exec(mail.text)[1];
  const server = await productionServer(root, { APP_SECRET: 'generated-account-security-test-secret', SETUP_CODE: 'setup-code-for-tests' });
  try {
    const { origin } = server;
    const client = () => browserless(origin, routeIds, server.diagnostics);
    const [login, register, setup, verify, magic, queue] = ['auth/login/index.ts', 'auth/register/index.ts', 'auth/setup/index.ts', 'auth/verify/index.ts', 'auth/magic/index.ts', 'dashboard/users/registrations/index.ts'];
    const admin = { name: 'Ada', email: 'ada@example.test', password: 'test-password-123' };
    const member = { name: 'Grace', email: 'grace@example.test', password: 'test-password-456' };
    const credentials = { email: member.email, password: member.password };

    // A fresh site sends sign-in to the setup page, which needs the code.
    const first = await fetch(origin + '/auth/login', { redirect: 'manual' });
    expect([first.status, first.headers.get('location')]).toEqual([302, '/auth/setup']);
    const owner = client();
    expect((await owner.action(setup, 'setup', [{ code: 'wrong', ...admin }])).error).toBe('The setup code is not right.');
    expect(owner.jar.has('session_id')).toBe(false);
    expect((await owner.action(setup, 'setup', [{ code: 'setup-code-for-tests', ...admin }]))._cossack_redirect).toBe('/dashboard');
    expect(owner.jar.has('session_id')).toBe(true);
    // The first account administers the site; setup then works for nobody else.
    await owner.page('/dashboard/users/registrations');
    expect((await client().action(setup, 'setup', [{ code: 'setup-code-for-tests', ...member }])).error).toBe('This site is already set up.');
    expect((await fetch(origin + '/auth/login', { redirect: 'manual' })).status).toBe(200);

    // A registration waits for its email's link: no session, and the password does not sign in.
    const visitor = client();
    const registered = await visitor.action(register, 'register', [member]);
    expect([registered.sent, visitor.jar.has('session_id')]).toEqual([true, false]);
    expect((await visitor.action(login, 'login', [credentials])).error).toBe('Invalid credentials');
    const [confirmation] = await mails();
    expect(confirmation).toMatchObject({ to: member.email, subject: expect.stringContaining('Confirm your email') });
    expect(confirmation.text).toContain(`${origin}/auth/verify?token=`);

    // The link names the account; confirming it leaves the account waiting for approval.
    expect(await visitor.page(`/auth/verify?token=${tokenOf(confirmation)}`)).toContain(member.email);
    const confirmed = await visitor.action(verify, 'confirm', [tokenOf(confirmation)]);
    expect([confirmed.pending, confirmed.failed, visitor.jar.has('session_id')]).toEqual([true, false, false]);
    expect((await visitor.action(verify, 'confirm', [tokenOf(confirmation)])).failed).toBe(true);
    expect((await visitor.action(login, 'login', [credentials])).error).toContain('waits for an administrator');

    // The administrator approves it; the account hears so and signs in, with the default role.
    const waiting = await owner.action(queue, 'approve', ['unknown']);
    expect(waiting.error).toBe('This account does not wait for approval.');
    expect(waiting.waiting).toMatchObject([{ email: member.email, verified: true }]);
    const approved = await owner.action(queue, 'approve', [waiting.waiting[0].id]);
    expect([approved.message, approved.waiting]).toEqual(['Approved. They can sign in now and got an email saying so.', []]);
    expect((await mails())[1]).toMatchObject({ to: member.email, subject: expect.stringContaining('is ready') });
    expect((await visitor.action(login, 'login', [credentials]))._cossack_redirect).toBe('/dashboard');
    await visitor.page('/dashboard/users');

    // A sign-in link: sent to an active account only, and it works once.
    const linked = client();
    await linked.action(login, 'sendLink', ['nobody@example.test']);
    await linked.action(login, 'sendLink', [member.email]);
    const sent = await mails();
    expect(sent).toHaveLength(3);
    expect(sent[2]).toMatchObject({ to: member.email, subject: expect.stringContaining('Sign in to') });
    expect(await linked.page(`/auth/magic?token=${tokenOf(sent[2])}`)).toContain(member.email);
    expect((await linked.action(magic, 'signIn', [tokenOf(sent[2])]))._cossack_redirect).toBe('/dashboard');
    expect(linked.jar.has('session_id')).toBe(true);
    expect((await client().action(magic, 'signIn', [tokenOf(sent[2])])).failed).toBe(true);
  } finally { await server.close(); }
}

it('sets up, confirms, approves and signs in by link on SQLite', () => registration('sqlite'), 300000);
it('sets up, confirms, approves and signs in by link on a RomeDB file', () => registration('romedb'), 300000);
