import { expect, it } from 'vitest';
import { desktopDevelopmentError } from '../src/development-error';

it('keeps the development client available while escaping source errors', async () => {
  const response = desktopDevelopmentError(new Error('<script>nativeAttack()</script>&"\''));
  const html = await response.text();
  expect(response.status).toBe(500);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(html).toContain('src="/@vite/client"');
  expect(html).not.toContain('<script>nativeAttack()');
  expect(html).toContain('&lt;script&gt;nativeAttack()&lt;/script&gt;&amp;&quot;&#39;');
});
it('bounds exception text in a native error page', async () => {
  expect((await desktopDevelopmentError('a'.repeat(100000)).text()).length).toBeLessThan(9000);
});
