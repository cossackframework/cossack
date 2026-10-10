import { describe, expect, it } from 'vitest';
import { parseStartupProfile } from '../src/startup-profile.js';

function profile() {
  return {
    startTime: 1000,
    endTime: 11_000,
    nodes: [
      { id: 1, callFrame: { functionName: 'PRIVATE_FUNCTION', url: 'https://private.example/secret' } },
      { id: 2, callFrame: { functionName: '(idle)' } },
      { id: 3, callFrame: { functionName: '(garbage collector)' } },
    ],
    samples: [1, 2, 3],
    timeDeltas: [2000, 4000, 3000],
  };
}

describe('parseStartupProfile', () => {
  it('reports the profile window and active samples, including garbage collection', () => {
    expect(parseStartupProfile(profile())).toEqual({ localStartupProfileMs: 10, localStartupActiveMs: 5 });
  });

  it('preserves valid zero active time', () => {
    expect(parseStartupProfile({ ...profile(), samples: [2], timeDeltas: [4000] }))
      .toEqual({ localStartupProfileMs: 10, localStartupActiveMs: 0 });
  });

  it('reports only the window when samples are empty', () => {
    expect(parseStartupProfile({ ...profile(), nodes: [], samples: [], timeDeltas: [] }))
      .toEqual({ localStartupProfileMs: 10 });
  });

  it('returns only safe numeric measurements without profile content', () => {
    const source = profile();
    const result = parseStartupProfile(source);
    expect(Object.keys(result!)).toEqual(['localStartupProfileMs', 'localStartupActiveMs']);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|private|url|functionName|nodes|samples/);
    expect(source).toEqual(profile());
  });

  it.each([
    null, [], {},
    { ...profile(), startTime: -1 },
    { ...profile(), startTime: 0.1 },
    { ...profile(), startTime: NaN },
    { ...profile(), endTime: Infinity },
    { ...profile(), endTime: Number.MAX_SAFE_INTEGER + 1 },
    { ...profile(), endTime: 1000 },
    { ...profile(), endTime: 999 },
    { ...profile(), nodes: {} },
    { ...profile(), nodes: [null] },
    { ...profile(), nodes: [{ id: 0, callFrame: { functionName: '' } }] },
    { ...profile(), nodes: [{ id: 1.5, callFrame: { functionName: '' } }] },
    { ...profile(), nodes: [{ id: 1, callFrame: { functionName: 1 } }] },
    { ...profile(), nodes: [{ id: 1, callFrame: { functionName: '' } }, { id: 1, callFrame: { functionName: '' } }] },
    { ...profile(), samples: [99], timeDeltas: [1] },
    { ...profile(), samples: [1.1], timeDeltas: [1] },
    { ...profile(), samples: {} },
    { ...profile(), timeDeltas: null },
    { ...profile(), timeDeltas: [1] },
    { ...profile(), timeDeltas: [1, -1, 1] },
    { ...profile(), timeDeltas: [1, NaN, 1] },
    { ...profile(), timeDeltas: [1, Infinity, 1] },
    { ...profile(), timeDeltas: [1, 0.5, 1] },
    { ...profile(), timeDeltas: [Number.MAX_SAFE_INTEGER, 1, 1] },
    { ...profile(), nodes: new Array(100_001) },
    { ...profile(), samples: new Array(1_000_001), timeDeltas: new Array(1_000_001) },
  ])('rejects malformed input %#', (input) => {
    expect(parseStartupProfile(input)).toBeUndefined();
  });

  it('does not throw when input access throws', () => {
    expect(parseStartupProfile({ get startTime() { throw new Error('PRIVATE'); } })).toBeUndefined();
  });
});
