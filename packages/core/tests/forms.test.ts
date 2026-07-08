// tests/forms.test.ts
import { describe, it, expect } from 'vitest';
import {
  parseFormData,
  parseKeyPath,
  ARRAY_NEXT,
} from '../src/shared/forms';

/** Build a FormData from [key, value] pairs (repeated keys allowed). */
function fd(...pairs: [string, string][]): FormData {
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

describe('parseFormData — prototype pollution safety (null-proto containers)', () => {
  it('preserves __proto__ as an exact own key without touching Object.prototype', () => {
    const proto = Object.prototype as any;
    const before = proto.polluted;
    const data = parseFormData(fd(['__proto__[polluted]', 'yes'])) as Record<string, any>;
    // Object.prototype must NOT have been modified.
    expect(proto.polluted).toBeUndefined();
    expect(before).toBeUndefined();
    // Data is preserved under the EXACT key '__proto__' (null-proto containers
    // have no __proto__ setter, so it's a normal own property).
    expect(Object.prototype.hasOwnProperty.call(data, '__proto__')).toBe(true);
    expect(data['__proto__'].polluted).toBe('yes');
  });

  it('preserves constructor keys without touching Object.prototype', () => {
    const proto = Object.prototype as any;
    const data = parseFormData(
      fd(['constructor[prototype][x]', '1']),
    ) as Record<string, any>;
    expect(proto.x).toBeUndefined();
    // The value survives under the exact key 'constructor'.
    expect(Object.prototype.hasOwnProperty.call(data, 'constructor')).toBe(true);
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
