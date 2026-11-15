import { describe, expect, it } from 'vitest';
import { MERGE_SIZE_LIMIT, hasConflictMarkers, mergeText } from '../src/merge.js';

const base = 'one\ntwo\nthree\nfour\nfive\n';

describe('mergeText', () => {
  it('merges changes to different lines', () => {
    const result = mergeText(base, 'ONE\ntwo\nthree\nfour\nfive\n', 'one\ntwo\nthree\nfour\nFIVE\nsix\n');
    expect(result).toEqual({ status: 'clean', text: 'ONE\ntwo\nthree\nfour\nFIVE\nsix\n' });
  });

  it('takes one side when the other did not change, and either when both made the same change', () => {
    expect(mergeText(base, base, 'new\n').text).toBe('new\n');
    expect(mergeText(base, 'mine\n', base).text).toBe('mine\n');
    expect(mergeText(base, 'same\n', 'same\n')).toEqual({ status: 'clean', text: 'same\n' });
  });

  it('marks a change to the same line as a conflict, with the base between the sides', () => {
    const result = mergeText(base, 'one\nMINE\nthree\nfour\nfive\n', 'one\nTHEIRS\nthree\nfour\nfive\n', { labels: { theirs: 'cossack 0.10.0' } });
    expect(result.status).toBe('conflict');
    expect(result.conflicts).toBe(1);
    expect(result.text).toBe('one\n<<<<<<< yours\nMINE\n||||||| base\ntwo\n=======\nTHEIRS\n>>>>>>> cossack 0.10.0\nthree\nfour\nfive\n');
    expect(hasConflictMarkers(result.text)).toBe(true);
    expect(hasConflictMarkers(base)).toBe(false);
  });

  it('keeps the final line break when the last line conflicts', () => {
    const result = mergeText('a\nb\n', 'a\nmine\n', 'a\ntheirs\n');
    expect(result.text.endsWith('>>>>>>> cossack\n')).toBe(true);
  });

  it('writes the line endings of the file on disk', () => {
    const crlf = text => text.replace(/\n/g, '\r\n');
    const result = mergeText(base, crlf('ONE\ntwo\nthree\nfour\nfive\n'), 'one\ntwo\nthree\nfour\nFIVE\n');
    expect(result).toEqual({ status: 'clean', text: crlf('ONE\ntwo\nthree\nfour\nFIVE\n') });
    // An upstream file with CRLF does not turn an LF project file into CRLF.
    expect(mergeText(crlf(base), 'ONE\ntwo\nthree\nfour\nfive\n', crlf(base)).text).toBe('ONE\ntwo\nthree\nfour\nfive\n');
  });

  it('refuses binary and non-UTF-8 content', () => {
    expect(mergeText(base, Buffer.from([0x89, 0x50, 0x00, 0x47]), base)).toEqual({ status: 'unmergeable', reason: 'binary' });
    expect(mergeText(base, Buffer.from([0xff, 0xfe, 0x41]), base)).toEqual({ status: 'unmergeable', reason: 'binary' });
    expect(mergeText(Buffer.from(base), Buffer.from('ONE\ntwo\nthree\nfour\nfive\n'), Buffer.from(base)).status).toBe('clean');
  });

  it('refuses content over the size limit', () => {
    expect(mergeText(base, 'x'.repeat(MERGE_SIZE_LIMIT + 1), base)).toEqual({ status: 'unmergeable', reason: 'too-large' });
  });
});
