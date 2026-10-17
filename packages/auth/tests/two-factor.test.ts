import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, totpCode, totpUri, verifyTotp } from '../src/two-factor';

// RFC 6238 appendix B: the ASCII secret "12345678901234567890" with SHA-1.
const RFC_SECRET = base32Encode(new TextEncoder().encode('12345678901234567890'));

describe('two-factor codes', () => {
    it('encodes base32 like RFC 4648 and round-trips', () => {
        expect(base32Encode(new TextEncoder().encode('foobar'))).toBe('MZXW6YTBOI');
        expect(new TextDecoder().decode(base32Decode('mzxw 6ytb oi'))).toBe('foobar');
        const secret = generateTotpSecret();
        expect(secret).toMatch(/^[A-Z2-7]{32}$/);
        expect(base32Encode(base32Decode(secret))).toBe(secret);
    });

    it('matches the RFC 6238 test vectors', async () => {
        expect(await totpCode(RFC_SECRET, Math.floor(59 / 30), 8)).toBe('94287082');
        expect(await totpCode(RFC_SECRET, Math.floor(1111111109 / 30), 8)).toBe('07081804');
        expect(await totpCode(RFC_SECRET, Math.floor(20000000000 / 30), 8)).toBe('65353130');
    });

    it('accepts the neighbouring steps once each and rejects others', async () => {
        const now = 1_800_000_000_000;
        const step = Math.floor(now / 30_000);
        const current = await totpCode(RFC_SECRET, step);
        expect(await verifyTotp(RFC_SECRET, current, { now })).toBe(step);
        expect(await verifyTotp(RFC_SECRET, current, { now, afterStep: step })).toBeNull();
        expect(await verifyTotp(RFC_SECRET, await totpCode(RFC_SECRET, step - 1), { now })).toBe(step - 1);
        expect(await verifyTotp(RFC_SECRET, await totpCode(RFC_SECRET, step - 2), { now })).toBeNull();
        expect(await verifyTotp(RFC_SECRET, 'abcdef', { now })).toBeNull();
        expect(await verifyTotp(RFC_SECRET, `${current.slice(0, 3)} ${current.slice(3)}`, { now })).toBe(step);
    });

    it('builds an otpauth URI and single-use recovery codes', async () => {
        expect(totpUri({ secret: 'ABC', issuer: 'My Site', account: 'ada@example.com' }))
            .toBe('otpauth://totp/My%20Site:ada%40example.com?secret=ABC&issuer=My+Site&algorithm=SHA1&digits=6&period=30');
        const codes = generateRecoveryCodes();
        expect(codes).toHaveLength(10);
        expect(new Set(codes).size).toBe(10);
        expect(codes[0]).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
        expect(await hashRecoveryCode(codes[0]!.toUpperCase().replace('-', ' '))).toBe(await hashRecoveryCode(codes[0]!));
    });
});
