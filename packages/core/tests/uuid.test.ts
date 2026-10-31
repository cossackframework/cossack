import { expect, it } from 'vitest';
import { uuidv7 } from '../src/index';

it('makes version 7 UUIDs that start with their time and sort by it', () => {
    const id = uuidv7(Date.UTC(2026, 9, 31, 12));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(parseInt(id.replaceAll('-', '').slice(0, 12), 16)).toBe(Date.UTC(2026, 9, 31, 12));
    expect(uuidv7(1000) < uuidv7(2000)).toBe(true);
    expect(new Set(Array.from({ length: 1000 }, () => uuidv7(5))).size).toBe(1000);
});
