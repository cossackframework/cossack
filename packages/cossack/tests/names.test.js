import { describe, it, expect } from 'vitest';
import {
  toKebab,
  toPascal,
  toCamel,
  parseName,
  resolvePageTarget,
  resolveFileTarget,
} from '../src/names.js';

describe('toKebab', () => {
  it('converts PascalCase', () => {
    expect(toKebab('UserWidget')).toBe('user-widget');
  });
  it('converts snake_case', () => {
    expect(toKebab('user_widget')).toBe('user-widget');
  });
  it('collapses separators', () => {
    expect(toKebab('foo--bar  baz')).toBe('foo-bar-baz');
  });
  it('handles empty input', () => {
    expect(toKebab('')).toBe('');
    expect(toKebab(null)).toBe('');
  });
});

describe('toPascal', () => {
  it('converts kebab', () => {
    expect(toPascal('my-page')).toBe('MyPage');
  });
  it('converts snake', () => {
    expect(toPascal('user_widget')).toBe('UserWidget');
  });
  it('preserves already-pascal', () => {
    expect(toPascal('Button')).toBe('Button');
  });
});

describe('toCamel', () => {
  it('converts kebab', () => {
    expect(toCamel('my-page')).toBe('myPage');
  });
  it('handles empty', () => {
    expect(toCamel('')).toBe('');
  });
});

describe('parseName', () => {
  it('extracts extension', () => {
    expect(parseName('my-page.md')).toMatchObject({ leaf: 'my-page', ext: '.md' });
  });
  it('splits path segments', () => {
    expect(parseName('/dashboard/my-page')).toMatchObject({
      segments: ['dashboard'],
      leaf: 'my-page',
      hasLeadingSlash: true,
    });
  });
  it('no extension by default', () => {
    expect(parseName('my-page').ext).toBe('');
  });
});

describe('resolvePageTarget', () => {
  it('folder style with index', () => {
    const t = resolvePageTarget('my-page');
    expect(t).toMatchObject({
      dir: 'src/pages/my-page',
      file: 'index',
      full: 'src/pages/my-page/index',
      ext: '.ts',
      className: 'MyPagePage',
      kebab: 'my-page',
    });
  });
  it('nested path', () => {
    const t = resolvePageTarget('/dashboard/my-page');
    expect(t.full).toBe('src/pages/dashboard/my-page/index');
    expect(t.dir).toBe('src/pages/dashboard/my-page');
  });
  it('custom extension', () => {
    expect(resolvePageTarget('my-page.md').ext).toBe('.md');
  });
});

describe('resolveFileTarget', () => {
  it('component (pascal)', () => {
    const t = resolveFileTarget('user-widget', 'components', { pascal: true });
    expect(t.full).toBe('src/components/UserWidget');
    expect(t.pascal).toBe('UserWidget');
  });
  it('service with suffix', () => {
    const t = resolveFileTarget('counter', 'services', {
      suffix: 'Service',
      pascal: true,
    });
    expect(t.full).toBe('src/services/CounterService');
  });
  it('middleware (kebab)', () => {
    const t = resolveFileTarget('request-logger', 'middlewares', {
      pascal: false,
    });
    expect(t.full).toBe('src/middlewares/request-logger');
    expect(t.camel).toBe('requestLogger');
  });
});
