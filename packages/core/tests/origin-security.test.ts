import { describe, it, expect } from 'vitest';
import { isOriginAllowed } from '../src/shared/origin-security';

describe('isOriginAllowed (CSWSH guard)', () => {
    it('allows same-origin by default', () => {
        expect(isOriginAllowed('https://app.com', 'https://app.com/ws/foo')).toBe(true);
    });

    it('rejects cross-origin by default', () => {
        expect(isOriginAllowed('https://evil.com', 'https://app.com/ws/foo')).toBe(false);
    });

    it('rejects a missing Origin header (non-browser client)', () => {
        expect(isOriginAllowed(undefined, 'https://app.com/ws/foo')).toBe(false);
        expect(isOriginAllowed(null, 'https://app.com/ws/foo')).toBe(false);
        expect(isOriginAllowed('', 'https://app.com/ws/foo')).toBe(false);
    });

    it('honours an explicit allowlist when provided', () => {
        const allowed = ['https://app.com', 'https://www.app.com'];
        expect(isOriginAllowed('https://app.com', 'https://other.com/ws', allowed)).toBe(true);
        expect(isOriginAllowed('https://www.app.com', 'https://other.com/ws', allowed)).toBe(true);
        expect(isOriginAllowed('https://evil.com', 'https://other.com/ws', allowed)).toBe(false);
    });

    it('explicit allowlist overrides the same-origin default', () => {
        // Even a "same-origin" request is rejected if not in the explicit list.
        expect(isOriginAllowed('https://app.com', 'https://app.com/ws', ['https://other.com'])).toBe(false);
    });

    it('rejects when the request URL is malformed', () => {
        expect(isOriginAllowed('https://app.com', 'not-a-url')).toBe(false);
    });

    it('treats an empty allowlist as "use same-origin default"', () => {
        expect(isOriginAllowed('https://app.com', 'https://app.com/ws', [])).toBe(true);
        expect(isOriginAllowed('https://evil.com', 'https://app.com/ws', [])).toBe(false);
    });

    it('distinguishes scheme (wss vs https origins do not match https default)', () => {
        // The Origin header uses http/https; the request URL origin is computed
        // from the URL scheme. A WS upgrade URL parsed as https gives an
        // https origin, so an http Origin must not match.
        expect(isOriginAllowed('http://app.com', 'https://app.com/ws')).toBe(false);
    });
});
