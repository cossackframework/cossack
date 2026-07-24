// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  DEMO_CATEGORIES,
  demoCatalog,
  demoCommandItems,
  demoEntries,
} from '../src/demo-catalog';

describe('demo catalog', () => {
  it('has unique labels, URLs, and command identifiers', () => {
    expect(new Set(demoEntries.map((entry) => entry.label)).size).toBe(demoEntries.length);
    expect(new Set(demoEntries.map((entry) => entry.url)).size).toBe(demoEntries.length);
    expect(new Set(demoCommandItems.map((item) => item.id)).size).toBe(demoCommandItems.length);
  });

  it('keeps every declared category populated and in canonical order', () => {
    expect(demoCatalog.map((group) => group.category)).toEqual(DEMO_CATEGORIES);
    for (const group of demoCatalog) {
      expect(group.entries.length, `${group.category} should not be empty`).toBeGreaterThan(0);
      expect(group.entries.every((entry) => entry.category === group.category)).toBe(true);
    }
  });

  it('uses canonical examples for dynamic routes', () => {
    expect(demoEntries.map((entry) => entry.url)).toEqual(expect.arrayContaining([
      '/hello/Cossack',
      '/view-transitions/1',
      '/ssg-demo/users/demo',
    ]));
  });

  it('flattens catalog metadata into command items', () => {
    expect(demoCommandItems).toEqual(demoEntries.map((entry) => ({
      id: entry.url,
      label: entry.label,
      group: entry.category,
    })));
  });

  it('excludes API endpoints, error boundaries, and implementation routes', () => {
    for (const entry of demoEntries) {
      expect(entry.url).not.toMatch(/^\/api(?:\/|$)/);
      expect(entry.url).not.toMatch(/\/(?:404|error|loading|layout)(?:\/|$)/);
    }
  });
});
