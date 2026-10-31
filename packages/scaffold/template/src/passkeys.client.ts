/**
 * Passkey ceremonies in the browser. This auth store signs in with passwords only; the CMS
 * auth store renders a version backed by SimpleWebAuthn.
 */
export const passkeysSupported = false;

export async function createPasskey(_options: unknown): Promise<unknown> {
    throw new Error('Passkeys are not available on this site.');
}

export async function usePasskey(_options: unknown): Promise<unknown> {
    throw new Error('Passkeys are not available on this site.');
}
