import { expect, it } from 'vitest';
import { transformSync } from 'esbuild';
import { renderRecipe, resolveRecipe } from '../src/index.js';
import { html, component, renderToString, bind } from '../../renderer/dist/index.js';
import { Field, Input, PasswordInput, Alert, Button } from '../../ui/dist/index.js';

it('renders generated login labels and validation descriptions onto the actual inputs', async () => {
  const files = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'auth' }));
  const source = files.get('src/pages/auth/login/index.ts').content.toString();
  const start = source.lastIndexOf('    render() {');
  expect(start).toBeGreaterThan(0);
  // Execute the generated render method with the real renderer/UI. The page's
  // auth submission service is outside this field-composition regression.
  const method = source.slice(start, source.lastIndexOf('}'));
  const { code } = transformSync(`const page = { ${method} };`, { loader: 'ts', target: 'es2022' });
  const page = new Function('html', 'component', 'Field', 'Input', 'PasswordInput', 'Alert', 'Button', '__', 'bind', code + '\nreturn page;')(
    html, component, Field, Input, PasswordInput, Alert, Button, value => value, bind,
  );
  const errors = {'form.email':'Invalid email', 'form.password':'Password is required'};
  Object.assign(page, {form:{email:'person@example.com',password:''}, error:null,
    getError:key=>errors[key], hasError:key=>!!errors[key], handleSubmit:()=>{}});
  const output = renderToString(page.render());
  for (const id of ['email','password']) {
    expect(output).toContain(`for="${id}"`);
    const input = output.match(new RegExp(`<input\\b[^>]*id="${id}"[^>]*>`))?.[0];
    expect(input).toBeDefined();
    expect(input).toContain(`aria-describedby="${id}-error"`);
    expect(input).toContain('aria-invalid="true"');
    expect(output).toContain(`id="${id}-error"`);
  }
  delete errors['form.email']; delete errors['form.password'];
  const cleared = renderToString(page.render());
  expect(cleared).not.toContain('aria-describedby');
  expect(cleared).not.toContain('aria-invalid="true"');
});
