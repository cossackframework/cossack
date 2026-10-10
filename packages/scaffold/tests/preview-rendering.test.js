import { expect, it } from 'vitest';
import { renderRecipe, resolveRecipe } from '../src/index.js';
it.each(['cloudflare', 'node'])('renders preview CI only for supported %s applications', async adapter => {
 const files = await renderRecipe(resolveRecipe({ adapter, preset: 'minimal' }));
 expect(files.has('.github/workflows/preview.yml')).toBe(adapter === 'cloudflare');
 if (adapter === 'cloudflare') {
  const source = files.get('.github/workflows/preview.yml').content.toString();
  expect(source).toContain('cossack preview create --account');
  expect(source).toContain('cossack preview cleanup --account');
  expect(files.get('.github/workflows/preview.yml').capability).toBe('base');
 }
 expect(files.get('.gitignore').content.toString()).toContain('.cossack/preview.json');
});
