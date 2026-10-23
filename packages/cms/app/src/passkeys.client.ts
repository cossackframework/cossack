/**
 * Passkey ceremonies in the browser through SimpleWebAuthn: create a passkey for the
 * signed-in user, or sign in with one. The server makes the options and checks the answers.
 */
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';

/** Whether this browser can create and use passkeys. */
export const passkeysSupported = typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';

export async function createPasskey(options: unknown) {
    const { startRegistration } = await import('@simplewebauthn/browser');
    return startRegistration({ optionsJSON: options as PublicKeyCredentialCreationOptionsJSON });
}

export async function usePasskey(options: unknown) {
    const { startAuthentication } = await import('@simplewebauthn/browser');
    return startAuthentication({ optionsJSON: options as PublicKeyCredentialRequestOptionsJSON });
}
