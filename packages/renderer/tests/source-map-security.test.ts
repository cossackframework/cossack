import { SourceMapConsumer } from 'source-map-js';
import { expect, it } from 'vitest';

const sectionMap = { version: 3, sources: ['input.css'], names: [], mappings: 'AAAA' };
const indexedMap = (line: number) => ({
  version: 3,
  sections: [{ offset: { line, column: 0 }, map: sectionMap }],
});

it('rejects oversized indexed map offsets before flattening can block the event loop', () => {
  expect(() => new SourceMapConsumer(indexedMap(1e9))).toThrow(/offset line must not exceed/);
  expect(() => new SourceMapConsumer({
    version: 3,
    sections: [{ offset: { line: 6e6, column: 0 }, map: indexedMap(6e6) }],
  })).toThrow(/including offsets of nested sections/);
});

it('keeps ordinary indexed CSS source maps usable', () => {
  const consumer = new SourceMapConsumer(indexedMap(10));
  expect(consumer.generatedPositionFor({ source: 'input.css', line: 1, column: 0 })).toMatchObject({ line: 11, column: 0 });
});
