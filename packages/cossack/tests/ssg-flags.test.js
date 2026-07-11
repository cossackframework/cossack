import { describe, it, expect } from 'vitest';
import { splitArgs } from '../src/commands/ssg.js';

describe('splitArgs (legacy SSG flag detection)', () => {
  it('returns empty arrays for no args', () => {
    expect(splitArgs([])).toEqual({ viteArgs: [], legacy: [] });
  });

  it('passes through plain vite args untouched', () => {
    const { viteArgs, legacy } = splitArgs(['--mode', 'staging', '--debug']);
    expect(viteArgs).toEqual(['--mode', 'staging', '--debug']);
    expect(legacy).toEqual([]);
  });

  it('detects a legacy flag with a separate value', () => {
    const { viteArgs, legacy } = splitArgs([
      '--base-url',
      'https://example.com',
      '--mode',
      'staging',
    ]);
    expect(viteArgs).toEqual(['--mode', 'staging']);
    expect(legacy).toEqual([{ flag: '--base-url', value: 'https://example.com' }]);
  });

  it('detects a legacy flag in --flag=value form', () => {
    const { viteArgs, legacy } = splitArgs([
      '--out-dir=dist/out',
      'build',
    ]);
    expect(viteArgs).toEqual(['build']);
    expect(legacy).toEqual([{ flag: '--out-dir', value: 'dist/out' }]);
  });

  it('detects multiple legacy flags (mixed forms)', () => {
    const { viteArgs, legacy } = splitArgs([
      '--base-url',
      'https://x.com',
      '--app=src/App.ts',
      '--template',
      'src/root.ts',
      '--mode',
      'production',
    ]);
    expect(viteArgs).toEqual(['--mode', 'production']);
    expect(legacy).toEqual([
      { flag: '--base-url', value: 'https://x.com' },
      { flag: '--app', value: 'src/App.ts' },
      { flag: '--template', value: 'src/root.ts' },
    ]);
  });

  it('recognizes camelCase variants of legacy flags', () => {
    const { viteArgs, legacy } = splitArgs(['--baseUrl', 'https://x.com', '--outDir', 'dist/y']);
    expect(viteArgs).toEqual([]);
    expect(legacy).toEqual([
      { flag: '--baseUrl', value: 'https://x.com' },
      { flag: '--outDir', value: 'dist/y' },
    ]);
  });

  it('recognizes --project-root and --projectRoot', () => {
    const { legacy } = splitArgs(['--project-root', '/tmp/x', '--projectRoot', '/tmp/y']);
    expect(legacy).toEqual([
      { flag: '--project-root', value: '/tmp/x' },
      { flag: '--projectRoot', value: '/tmp/y' },
    ]);
  });

  it('treats a legacy flag at the end with no value as flag-only', () => {
    const { viteArgs, legacy } = splitArgs(['--base-url']);
    expect(viteArgs).toEqual([]);
    expect(legacy).toEqual([{ flag: '--base-url', value: undefined }]);
  });

  it('does not consume the next arg as a value if it starts with -', () => {
    const { viteArgs, legacy } = splitArgs(['--base-url', '--debug']);
    expect(viteArgs).toEqual(['--debug']);
    expect(legacy).toEqual([{ flag: '--base-url', value: undefined }]);
  });

  it('passes through unknown flags that are not in the legacy set', () => {
    const { viteArgs, legacy } = splitArgs(['--custom', 'value', '--base-url', 'https://x.com']);
    expect(viteArgs).toEqual(['--custom', 'value']);
    expect(legacy).toEqual([{ flag: '--base-url', value: 'https://x.com' }]);
  });
});
