import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';

export async function writeOldInputAcceptance(root, repository) {
  const catalog = JSON.parse(await fs.readFile(path.join(repository, 'packages/core/agent-docs.json'), 'utf8'));
  const guide = catalog.guides.find(guide => guide.id === 'safe-old-input');
  const example = guide?.examples.find(example => example.id === 'public-form-fields');
  expect(example).toBeTruthy();
  await fs.mkdir(path.join(root, 'src/pages/guidance-old-input'), { recursive: true });
  // The authored form recipe runs verbatim through the actual framework.
  await fs.writeFile(path.join(root, 'src/pages/guidance-old-input/index.ts'), example.source);
  await fs.mkdir(path.join(root, 'src/pages/api'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/pages/api/old-input-origin.ts'),
    `import type { Context } from 'hono';\nexport const GET = (c: Context) => c.json({ origin: new URL(c.req.url).origin });\n`);
  await fs.mkdir(path.join(root, 'src/pages/old-input-rpc'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/pages/old-input-rpc/index.ts'), `
import { Cossack, Page, Server, flash, flashInput } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
@Page({ transport: 'http' })
export default class InputRpc extends Cossack {
  async post() {
    await this.c.getFormData();
    flash('success', 'Parsed.');
    return this.c.redirect('/guidance-old-input');
  }
  @Server() retain(data: Record<string, unknown>) {
    flashInput(data, { fields: ['name', 'email', 'profile.city', 'tags', 'contacts.0.label',
      'password', 'profile.refreshToken', 'api_key', 'pin'] });
    flash('errors', { email: 'Enter a valid email.' });
    return this.c.redirect('/guidance-old-input');
  }
  @Server() fail(data: Record<string, unknown>) {
    flashInput(data, { fields: ['name'] });
    throw new Error('PRIVATE_OLD_INPUT_FAILED_ACTION');
  }
  render() { return html\`<main>Old input fixture</main>\`; }
}
`);
}

export async function checkOldInputAcceptance(request, routeId) {
  const privateValues = ['PRIVATE_PASSWORD_INPUT', 'PRIVATE_CUSTOM_UNLOCK_PHRASE', 'PRIVATE_NESTED_TOKEN',
    'PRIVATE_CONTACT_CREDENTIAL', 'PRIVATE_API_KEY', 'PRIVATE_PIN'];
  const data = { name: 'Alice 🙂', email: 'invalid', password: privateValues[0], unlockPhrase: privateValues[1],
    profile: { city: '東京', refreshToken: privateValues[2] },
    contacts: [{ label: 'Home', credential: privateValues[3] }], tags: ['first', 'second'], api_key: privateValues[4], pin: privateValues[5] };
  const form = () => {
    const body = new FormData();
    for (const [key, value] of Object.entries(data)) if (typeof value === 'string') body.set(key, value);
    body.set('profile[city]', data.profile.city); body.set('profile[refreshToken]', data.profile.refreshToken);
    body.set('contacts[][label]', data.contacts[0].label); body.set('contacts[][credential]', data.contacts[0].credential);
    for (const tag of data.tags) body.append('tags[]', tag);
    return body;
  };
  const { origin } = await (await request('/api/old-input-origin')).json();
  const postForm = async route => {
    // Encode native multipart bytes before crossing the Miniflare/Node realms.
    // Passing Node FormData directly to its Request constructor loses the type.
    const encoded = new Request(origin + route, { method: 'POST', headers: { origin }, body: form() });
    return request(route, { method: 'POST', headers: encoded.headers, body: new Uint8Array(await encoded.arrayBuffer()) });
  };
  const assertPrivate = text => { for (const secret of privateValues) expect(text).not.toContain(secret); };
  const flashCookie = response => {
    const header = response.headers.getSetCookie().find(value => value.startsWith('cossack_flash='));
    expect(header).toBeTruthy();
    expect(header).toMatch(/HttpOnly/i); expect(header).toMatch(/SameSite=Lax/i);
    const cookie = header.split(';')[0];
    const payload = JSON.parse(Buffer.from(cookie.slice('cossack_flash='.length).split('.')[0], 'base64url').toString('utf8'));
    assertPrivate(JSON.stringify(payload));
    return { cookie, payload };
  };
  const restored = async cookie => {
    const response = await request('/guidance-old-input', { headers: { cookie } });
    expect(response.status).toBe(200);
    const text = await response.text(); assertPrivate(text);
    expect(response.headers.get('set-cookie')).toMatch(/cossack_flash=;.*Max-Age=0/);
    const state = JSON.parse(text.match(/window\.__INITIAL_STATE__\s*=\s*(.*?)<\/script>/s)[1]).public;
    expect(state).toMatchObject({ name: data.name, email: data.email, city: data.profile.city,
      errors: { email: 'Enter a valid email.' } });
    const empty = await request('/guidance-old-input');
    const emptyText = await empty.text(); assertPrivate(emptyText);
    const next = JSON.parse(emptyText.match(/window\.__INITIAL_STATE__\s*=\s*(.*?)<\/script>/s)[1]).public;
    expect(next).toMatchObject({ name: '', email: '', city: '', errors: null });
  };
  const native = await postForm('/guidance-old-input');
  expect(native.status, await native.clone().text()).toBe(302);
  expect(native.headers.get('location')).toBe('/guidance-old-input');
  const posted = flashCookie(native);
  expect(posted.payload).toEqual({ __input: { name: data.name, email: data.email, profile: { city: data.profile.city } },
    errors: { email: 'Enter a valid email.' } });
  await restored(posted.cookie);

  const rpc = async (action, payload, cookie) => request('/crpc', { method: 'POST', headers: {
    origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}),
  }, body: JSON.stringify({ componentRouteId: routeId, action, payload: [payload], state: { public: {} } }) });
  const retained = await rpc('retain', data);
  expect(retained.status, await retained.clone().text()).toBe(200);
  const body = await retained.text(); assertPrivate(body);
  expect(JSON.parse(body)).toMatchObject({ _cossack_redirect: '/guidance-old-input' });
  const manual = flashCookie(retained);
  expect(manual.payload.__input).toEqual({ name: data.name, email: data.email, profile: { city: data.profile.city },
    tags: data.tags, contacts: [{ label: 'Home' }] });
  const failed = await rpc('fail', { name: 'Partial outgoing' }, manual.cookie);
  expect(failed.status).toBe(500);
  expect(failed.headers.get('set-cookie') ?? '').not.toContain('cossack_flash=');
  expect(await failed.text()).not.toContain('PRIVATE_OLD_INPUT_FAILED_ACTION');
  await restored(manual.cookie);

  const defaultPost = await postForm('/old-input-rpc');
  expect(defaultPost.status).toBe(302);
  const defaultFlash = flashCookie(defaultPost);
  expect(defaultFlash.payload).toEqual({ success: 'Parsed.' });
}
