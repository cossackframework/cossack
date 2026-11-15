/**
 * The browser's half of the bot check on the sign-in and registration forms (auth-bot-check.ts
 * is the server's): the token the Turnstile widget put in a form, read before a server action is called.
 */
export function botCheckToken(form: EventTarget | null): string {
  const field = (form as HTMLFormElement | null)?.querySelector?.('input[name="cf-turnstile-response"]') as HTMLInputElement | null | undefined;
  return field?.value ?? '';
}

/** The message a failed bot check shows. */
export const BOT_CHECK_FAILED = 'The check against bots failed. Try again.';
