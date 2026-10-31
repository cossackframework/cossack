/**
 * Passkeys (WebAuthn) through SimpleWebAuthn: the options a browser needs to create or use a
 * passkey, and verification of its answer. Challenges and credentials are stored by the
 * application; public keys travel as base64url text.
 */
import {
    generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
    type AuthenticationResponseJSON, type PublicKeyCredentialCreationOptionsJSON, type PublicKeyCredentialRequestOptionsJSON, type RegistrationResponseJSON,
} from '@simplewebauthn/server';

export type { AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON };

export interface PasskeyConfig {
    /** Shown by the browser, such as the site title. */
    readonly rpName: string;
    /** The site's host name, such as `example.com`. Passkeys work there and on its subdomains. */
    readonly rpID: string;
    /** Origins the browser may report, such as `https://example.com`. */
    readonly origin: string | readonly string[];
}

/** A stored passkey: its credential ID, public key and signature counter. */
export interface StoredPasskey {
    readonly id: string;
    /** COSE public key, base64url. */
    readonly publicKey: string;
    readonly counter: number;
    readonly transports?: readonly string[];
}

export interface RegisteredPasskey extends StoredPasskey {
    /** `multiDevice` for synced passkeys, `singleDevice` for security keys. */
    readonly deviceType: 'singleDevice' | 'multiDevice';
    readonly backedUp: boolean;
}

/** Options to create a passkey for the user. Existing passkeys are excluded, so a device registers once. */
export async function passkeyRegistrationOptions(config: PasskeyConfig, user: { id: string; name: string; displayName?: string }, existing: readonly StoredPasskey[] = []): Promise<PublicKeyCredentialCreationOptionsJSON> {
    return generateRegistrationOptions({
        rpName: config.rpName, rpID: config.rpID, userName: user.name, userDisplayName: user.displayName ?? user.name,
        userID: new TextEncoder().encode(user.id), attestationType: 'none',
        excludeCredentials: existing.map(passkey => ({ id: passkey.id, ...(passkey.transports ? { transports: [...passkey.transports] } : {}) })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
}

/** The new passkey, when the browser's answer matches the challenge and origin; otherwise null. */
export async function verifyPasskeyRegistration(config: PasskeyConfig, response: RegistrationResponseJSON, expectedChallenge: string): Promise<RegisteredPasskey | null> {
    try {
        const result = await verifyRegistrationResponse({
            response, expectedChallenge, expectedOrigin: [...[config.origin].flat()], expectedRPID: config.rpID, requireUserVerification: true,
        });
        if (!result.verified) return null;
        const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
        return {
            id: credential.id, publicKey: base64Url(credential.publicKey), counter: credential.counter,
            ...(credential.transports ? { transports: [...credential.transports] } : {}), deviceType: credentialDeviceType, backedUp: credentialBackedUp,
        };
    } catch {
        return null;
    }
}

/** Options to sign in with a passkey. Without `allow`, the browser offers every passkey for the site. */
export async function passkeyAuthenticationOptions(config: PasskeyConfig, allow: readonly StoredPasskey[] = []): Promise<PublicKeyCredentialRequestOptionsJSON> {
    return generateAuthenticationOptions({
        rpID: config.rpID, userVerification: 'required',
        ...(allow.length ? { allowCredentials: allow.map(passkey => ({ id: passkey.id, ...(passkey.transports ? { transports: [...passkey.transports] } : {}) })) } : {}),
    });
}

/** The passkey's new signature counter when the answer is valid for it; otherwise null. */
export async function verifyPasskeyAuthentication(config: PasskeyConfig, response: AuthenticationResponseJSON, expectedChallenge: string, passkey: StoredPasskey): Promise<{ counter: number } | null> {
    if (response?.id !== passkey.id) return null;
    try {
        const result = await verifyAuthenticationResponse({
            response, expectedChallenge, expectedOrigin: [...[config.origin].flat()], expectedRPID: config.rpID, requireUserVerification: true,
            credential: { id: passkey.id, publicKey: fromBase64Url(passkey.publicKey), counter: passkey.counter, ...(passkey.transports ? { transports: [...passkey.transports] } : {}) },
        });
        return result.verified ? { counter: result.authenticationInfo.newCounter } : null;
    } catch {
        return null;
    }
}

/** The user handle a discoverable passkey returned, as the user ID given at registration. */
export function passkeyUserId(response: AuthenticationResponseJSON): string | null {
    const handle = response?.response?.userHandle;
    if (typeof handle !== 'string' || !handle) return null;
    try { return new TextDecoder().decode(fromBase64Url(handle)); } catch { return null; }
}

function base64Url(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
    const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(text.length / 4) * 4, '='));
    return Uint8Array.from(binary, character => character.charCodeAt(0));
}
