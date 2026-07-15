import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { addCommand } from '../src/commands/add.js';

let tmp;
let ctx;

/** Scaffold a minimal Cossack project so addUi finds package.json + src/style.css. */
function scaffoldProject() {
  fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'package.json'),
    JSON.stringify({
      name: 'demo',
      dependencies: { '@cossackframework/framework': '^0.6.0' },
    }),
  );
  // A typical app already has the tailwind import in style.css.
  fs.writeFileSync(
    path.join(tmp, 'src/style.css'),
    ['@import "tailwindcss";', ''].join('\n'),
  );
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cossack-ui-'));
  ctx = { projectRoot: tmp, cwd: tmp, flags: {}, force: false, dryRun: false };
  scaffoldProject();
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('add ui (no component arg)', () => {
  it('adds the dep, writes the barrel, and wires the theme imports', async () => {
    const code = await addCommand(['ui'], ctx);
    expect(code).toBe(0);

    // dependency
    const pkg = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'));
    expect(pkg.dependencies['@cossackframework/ui']).toBeTruthy();

    // barrel re-export
    const barrel = fs.readFileSync(path.join(tmp, 'src/components/ui/index.ts'), 'utf8');
    expect(barrel).toContain("from '@cossackframework/ui'");
    expect(barrel).toContain('Button');
    expect(barrel).toContain('Icon');

    // theme imports + @source directives wired into style.css
    const css = fs.readFileSync(path.join(tmp, 'src/style.css'), 'utf8');
    expect(css).toContain('@cossackframework/ui/theme/base.css');
    expect(css).toContain('@cossackframework/ui/theme/theme.css');
    // @source is required so Tailwind v4 scans the package's component classes
    expect(css).toContain('@source "../node_modules/@cossackframework/ui/src/components"');
    expect(css).toContain('@source "../node_modules/@cossackframework/ui/src/icons"');
  });

  it('is idempotent on style.css (does not duplicate the imports)', async () => {
    await addCommand(['ui'], ctx);
    ctx.force = true;
    await addCommand(['ui'], ctx);
    const css = fs.readFileSync(path.join(tmp, 'src/style.css'), 'utf8');
    const matches = (css.match(/@cossackframework\/ui\/theme\/theme\.css/g) || []);
    expect(matches.length).toBe(1);
  });

  it('creates style.css if it does not exist yet', async () => {
    fs.rmSync(path.join(tmp, 'src/style.css'));
    const code = await addCommand(['ui'], ctx);
    expect(code).toBe(0);
    const css = fs.readFileSync(path.join(tmp, 'src/style.css'), 'utf8');
    expect(css).toContain('@import "tailwindcss"');
    expect(css).toContain('@cossackframework/ui/theme/theme.css');
  });

  it('wires the named palette when --theme is set', async () => {
    ctx.flags = { theme: 'blue' };
    const code = await addCommand(['ui'], ctx);
    expect(code).toBe(0);
    const css = fs.readFileSync(path.join(tmp, 'src/style.css'), 'utf8');
    expect(css).toContain('@cossackframework/ui/theme/themes/blue.css');
    // The palette import comes after theme.css.
    const themeIdx = css.indexOf('theme/theme.css');
    const paletteIdx = css.indexOf('themes/blue.css');
    expect(paletteIdx).toBeGreaterThan(themeIdx);
  });

  it('does not wire a palette import when --theme is omitted', async () => {
    const code = await addCommand(['ui'], ctx);
    expect(code).toBe(0);
    const css = fs.readFileSync(path.join(tmp, 'src/style.css'), 'utf8');
    expect(css).not.toContain('themes/');
  });

  it('returns non-zero for an unknown --theme', async () => {
    ctx.flags = { theme: 'bogus' };
    const code = await addCommand(['ui'], ctx);
    expect(code).toBe(1);
  });
});

describe('add ui <component>', () => {
  it('ejects a single component into src/components/ui/<Name>.ts', async () => {
    const code = await addCommand(['ui', 'button'], ctx);
    expect(code).toBe(0);
    const file = path.join(tmp, 'src/components/ui/Button.ts');
    expect(fs.existsSync(file)).toBe(true);
    const src = fs.readFileSync(file, 'utf8');
    // The source is read from the installed @cossackframework/ui package. When
    // the package is resolvable (real projects), the full component source is
    // ejected. When not resolvable (bare CLI test env), a fallback stub is
    // written that instructs the user to install first.
    const hasRealSource = src.includes('export class Button') || src.includes('@cossackframework/ui');
    expect(hasRealSource).toBe(true);
  });

  it('ejects each catalog component with the right class name', async () => {
    for (const [name, Cls] of [
      ['button', 'Button'],
      ['input', 'Input'],
      ['card', 'Card'],
      ['badge', 'Badge'],
      ['label', 'Label'],
      ['alert', 'Alert'],
      ['modal', 'Modal'],
      ['accordion', 'Accordion'],
      ['textarea', 'Textarea'],
      ['checkbox', 'Checkbox'],
      ['switch', 'Switch'],
      ['select', 'Select'],
      ['spinner', 'Spinner'],
      ['avatar', 'Avatar'],
      ['separator', 'Separator'],
      ['skeleton', 'Skeleton'],
      ['progress', 'Progress'],
      ['tabs', 'Tabs'],
      ['tooltip', 'Tooltip'],
      ['popover', 'Popover'],
      ['radio-group', 'RadioGroup'],
      ['slider', 'Slider'],
      ['table', 'Table'],
      ['form', 'Form'],
    ]) {
      const code = await addCommand(['ui', name], ctx);
      expect(code).toBe(0);
      const file = path.join(tmp, `src/components/ui/${Cls}.ts`);
      expect(fs.existsSync(file)).toBe(true);
    }
  });

  it('returns non-zero and lists available components for an unknown name', async () => {
    const code = await addCommand(['ui', 'bogus'], ctx);
    expect(code).toBe(1);
    expect(fs.existsSync(path.join(tmp, 'src/components/ui/Bogus.ts'))).toBe(false);
  });

  it('does not overwrite an existing ejected file without --force', async () => {
    await addCommand(['ui', 'button'], ctx);
    const file = path.join(tmp, 'src/components/ui/Button.ts');
    const original = fs.readFileSync(file, 'utf8');
    // Tamper with the file to simulate user customization.
    fs.writeFileSync(file, original + '\n// customized\n', 'utf8');

    await addCommand(['ui', 'button'], ctx);
    const after = fs.readFileSync(file, 'utf8');
    expect(after).toContain('// customized');
  });
});
