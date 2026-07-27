import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'),
);

describe('published package contract', () => {
  it('exports compiled JavaScript and declaration files', () => {
    expect(packageJson.main).toBe('./dist/index.js');
    expect(packageJson.module).toBe('./dist/index.js');
    expect(packageJson.types).toBe('./dist/index.d.ts');
    expect(packageJson.exports['.']).toEqual({
      types: './dist/index.d.ts',
      import: './dist/index.js',
    });
    expect(packageJson.exports['./blocks']).toEqual({
      types: './dist/blocks/index.d.ts',
      import: './dist/blocks/index.js',
    });
    expect(packageJson.files).toContain('dist');
  });

  it('keeps blocks opt-in and emits their declarations', () => {
    const mainDeclaration = readFileSync(resolve(__dirname, '..', 'dist/index.d.ts'), 'utf8');
    const blocksDeclaration = readFileSync(
      resolve(__dirname, '..', 'dist/blocks/index.d.ts'),
      'utf8',
    );
    expect(mainDeclaration).not.toContain("from './blocks");
    expect(blocksDeclaration).toContain('AuthForm');
    expect(blocksDeclaration).toContain('CommandPalette');
    expect(blocksDeclaration).toContain('DashboardStat');
    expect(blocksDeclaration).toContain('SettingsPanel');
  });

  it('continues publishing every exported theme stylesheet', () => {
    expect(packageJson.files).toContain('src/theme');
    for (const [subpath, target] of Object.entries(packageJson.exports)) {
      if (subpath.startsWith('./theme/')) {
        expect(target).toBe(`./src/${subpath.slice(2)}`);
      }
    }
  });

  it('builds before publishing', () => {
    expect(packageJson.scripts.prepublishOnly).toBe('pnpm run build');
  });
});
