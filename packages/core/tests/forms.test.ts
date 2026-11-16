// tests/forms.test.ts
import { describe, it, expect } from 'vitest';
import {
  parseFormData,
  parseKeyPath,
  ARRAY_NEXT,
} from '../src/shared/forms';

/** Build a FormData from [key, value] pairs (repeated keys allowed). */
function fd(...pairs: [string, string | File][]): FormData {
  const data = new FormData();
  for (const [k, v] of pairs) data.append(k, v);
  return data;
}

describe('parseKeyPath', () => {
  it('parses a flat key into a single segment', () => {
    expect(parseKeyPath('name')).toEqual(['name']);
  });

  it('parses one level of nesting', () => {
    expect(parseKeyPath('address[street]')).toEqual(['address', 'street']);
  });

  it('parses deep nesting', () => {
    expect(parseKeyPath('a[b][c][d]')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('parses a trailing bare [] as ARRAY_NEXT', () => {
    expect(parseKeyPath('tags[]')).toEqual(['tags', ARRAY_NEXT]);
  });

  it('parses a [] in the middle', () => {
    expect(parseKeyPath('contacts[][email]')).toEqual([
      'contacts',
      ARRAY_NEXT,
      'email',
    ]);
  });

  it('parses trailing [] on a nested key', () => {
    expect(parseKeyPath('address[street][]')).toEqual([
      'address',
      'street',
      ARRAY_NEXT,
    ]);
  });

  it('returns [] for an empty key', () => {
    expect(parseKeyPath('')).toEqual([]);
  });

  it('stops at an unterminated bracket', () => {
    // 'address[street' has no closing ']' -> only the leading segment.
    expect(parseKeyPath('address[street')).toEqual(['address']);
  });
});

describe('parseFormData — flat keys', () => {
  it('returns a scalar for a single value', () => {
    expect(parseFormData(fd(['name', 'Tan']))).toEqual({ name: 'Tan' });
  });

  it('handles multiple flat keys', () => {
    expect(parseFormData(fd(['a', '1'], ['b', '2']))).toEqual({ a: '1', b: '2' });
  });
});

describe('parseFormData — nested objects', () => {
  it('parses a one-level nest', () => {
    expect(
      parseFormData(
        fd(
          ['address[street]', '123 Main St'],
          ['address[city]', 'Anytown'],
          ['address[state]', 'CA'],
        ),
      ),
    ).toEqual({
      address: { street: '123 Main St', city: 'Anytown', state: 'CA' },
    });
  });

  it('parses a deep nest', () => {
    expect(parseFormData(fd(['a[b][c][d]', 'deep']))).toEqual({
      a: { b: { c: { d: 'deep' } } },
    });
  });
});

describe('parseFormData — arrays', () => {
  it('collects repeated [] keys into an array', () => {
    expect(
      parseFormData(fd(['tags[]', 'a'], ['tags[]', 'b'], ['tags[]', 'c'])),
    ).toEqual({ tags: ['a', 'b', 'c'] });
  });

  it('keeps a single [] value as a length-1 array', () => {
    // Author explicitly asked for an array via [], so even one value stays [].
    expect(parseFormData(fd(['tags[]', 'only']))).toEqual({ tags: ['only'] });
  });

  it('parses a [] on a nested key', () => {
    expect(
      parseFormData(fd(['address[street][]', '1'], ['address[street][]', '2'])),
    ).toEqual({ address: { street: ['1', '2'] } });
  });
});

describe('parseFormData — array of objects', () => {
  it('merges sibling keys into the same array element', () => {
    // contacts[][email] + contacts[][name] -> ONE object in the array.
    expect(
      parseFormData(
        fd(['contacts[][email]', 'a@x.com'], ['contacts[][name]', 'A']),
      ),
    ).toEqual({ contacts: [{ email: 'a@x.com', name: 'A' }] });
  });

  it('repeated same inner key opens a new element', () => {
    // Two contacts[][email] -> two objects.
    expect(
      parseFormData(
        fd(['contacts[][email]', 'a@x.com'], ['contacts[][email]', 'b@x.com']),
      ),
    ).toEqual({ contacts: [{ email: 'a@x.com' }, { email: 'b@x.com' }] });
  });

  it('handles a mix of fields across two records', () => {
    expect(
      parseFormData(
        fd(
          ['users[][name]', 'Alice'],
          ['users[][email]', 'alice@x.com'],
          ['users[][name]', 'Bob'],
          ['users[][email]', 'bob@x.com'],
        ),
      ),
    ).toEqual({
      users: [
        { name: 'Alice', email: 'alice@x.com' },
        { name: 'Bob', email: 'bob@x.com' },
      ],
    });
  });
});

describe('parseFormData — repeated (non-[]) keys', () => {
  it('promotes a repeated plain key into an array', () => {
    // No [] suffix, but the same key twice -> array (Hono/FormData multi-value).
    expect(parseFormData(fd(['color', 'red'], ['color', 'blue']))).toEqual({
      color: ['red', 'blue'],
    });
  });
});

describe('parseFormData — input shapes', () => {
  it('accepts a plain record', () => {
    expect(parseFormData({ 'a[b]': '1', c: '2' })).toEqual({
      a: { b: '1' },
      c: '2',
    });
  });

  it('passes File objects through untouched (nested key)', () => {
    const form = new FormData();
    const file = new File(['contents'], 'f.txt', { type: 'text/plain' });
    form.append('profile[avatar]', file);
    const data = parseFormData(form) as { profile: { avatar: File } };
    expect(data.profile.avatar).toBeInstanceOf(File);
    expect(data.profile.avatar.name).toBe('f.txt');
  });
});

describe('parseFormData — prototype pollution safety', () => {
  const proto = Object.prototype as any;

  it('drops keys with __proto__, constructor or prototype segments', () => {
    const data = parseFormData(fd(
      ['__proto__[polluted]', 'yes'], ['constructor[prototype][x]', '1'], ['a[prototype]', '2'], ['kept', 'ok'],
    )) as Record<string, any>;
    expect(proto.polluted).toBeUndefined();
    expect(proto.x).toBeUndefined();
    expect(Object.keys(data)).toEqual(['kept']);
    // Safe to spread into a plain object: no own __proto__ key to set its prototype.
    expect(Object.getPrototypeOf({ ...data })).toBe(Object.prototype);
  });

  it('never walks a repeated key\'s values or a string to reach a prototype', () => {
    parseFormData(fd(['a', '1'], ['a', '2'], ['a[__proto__][__proto__][polluted]', 'yes']));
    parseFormData(fd(['b', 'x'], ['b[length][polluted]', 'yes'], ['b[x]', 'y']));
    parseFormData(fd(['c[]', '1'], ['c[length]', '5'], ['c[push][polluted]', 'yes']));
    expect(proto.polluted).toBeUndefined();
    expect(([] as any).polluted).toBeUndefined();
    expect(('' as any).polluted).toBeUndefined();
  });

  it('keeps the first of two conflicting shapes, without throwing', () => {
    expect(parseFormData(fd(['a', '1'], ['a[x]', '2']))).toEqual({ a: '1' });
    expect(parseFormData(fd(['a[x]', '1'], ['a[]', '2']))).toEqual({ a: { x: '1' } });
    expect(parseFormData(fd(['t[]', '1'], ['t[name]', '2']))).toEqual({ t: ['1'] });
    // A File is a value, never a container.
    const file = new File(['x'], 'f.txt');
    const data = parseFormData(fd(['f', file], ['f[name]', 'evil'])) as Record<string, any>;
    expect(data.f).toBe(file);
    expect(file.name).toBe('f.txt');
  });

  it('produces containers with a null prototype', () => {
    const data = parseFormData(fd(['a[b]', '1'])) as Record<string, any>;
    expect(Object.getPrototypeOf(data)).toBeNull();
    expect(Object.getPrototypeOf(data.a)).toBeNull();
  });
});

describe('parseFormData — edge cases', () => {
  it('ignores values with an empty key', () => {
    expect(parseFormData(fd(['', 'orphan']))).toEqual({});
  });

  it('treats a key with only a leading [] conservatively', () => {
    // '[foo]' has no leading name segment; it yields ['foo'] (the bracket
    // content) per the tokenizer, never polluting a global.
    expect(parseFormData(fd(['[foo]', 'bar']))).toEqual({ foo: 'bar' });
  });

  it('overwrites a single value when the same key appears once', () => {
    // Distinct single-value keys just set their value.
    expect(parseFormData(fd(['x', '1'], ['y', '2']))).toEqual({ x: '1', y: '2' });
  });
});
