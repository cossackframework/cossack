# Turnstile server verification

Create a verifier in server-only code with `createTurnstileVerifier` from
`@cossackframework/auth/turnstile`. Supply the secret through private server
configuration. The public sitekey belongs in the browser; the secret never does.
The helper uses Web APIs and works with Workers, Node.js, and Deno fetch.

`expectedHostname` and `expectedAction` are required server-owned values. Configure
the browser widget with the same action. Do not derive either expected value from
submission fields or an untrusted Host header. Each verification calls Siteverify;
a widget success event or client-supplied `success` field grants no access.

The input is `{ token: unknown, remoteIP?: string }`. Supply remote IP only from a
trusted adapter/proxy source, rather than an arbitrary forwarded header. The result
is `{ success: true }` or `{ success: false, code, retryable }`. Failures contain
fixed framework codes, with no token, secret, provider payload, or exception details.
Invalid server configuration throws a fixed `TurnstileConfigurationError`.

## Protect a validated mutation

Validate the application fields on the server, verify the token, and only then
perform the protected mutation. Keep authentication, authorization, CSRF protection,
and rate limits where the application needs them; a bot challenge does not replace
those checks. A component's server method can use this same sequence.

```ts
import { validateObject } from '@cossackframework/core';
import { createTurnstileVerifier } from '@cossackframework/auth/turnstile';

// Construct inside your server configuration factory using private configuration.
const verifier = createTurnstileVerifier({
  secret: privateConfig.turnstileSecret,
  expectedHostname: 'forms.example.com',
  expectedAction: 'contact',
});

async function submitContact(request: Request) {
  const form = await request.formData(); // Enforce request body limits at the route.
  const checked = await validateObject({ message: form.get('message') }, {
    message: { required: true, maxLength: 2000 },
  });
  if (!checked.valid || typeof checked.data.message !== 'string') {
    return new Response('Invalid submission', { status: 400 });
  }
  const verification = await verifier.verify({ token: form.get('cf-turnstile-response') });
  if (!verification.success) return new Response('Verification required', { status: 400 });
  await saveContactMessage(checked.data.message);
  return new Response('Accepted');
}
```

## Expiry, resubmission, and retries

Cloudflare tokens expire after five minutes and are single-use. Expiry and reuse
both map to `COSSACK_TURNSTILE_EXPIRED_OR_REUSED`; reset the widget and obtain a
fresh token before resubmitting. The helper does not guess token age or cache a
successful token. See [Cloudflare server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).

The default overall deadline is 5000 ms, configurable from 1 to 15000 ms. It covers
fetch, response reads, and retries. Responses are limited to 16 KiB and 1024 chunks.
Network errors, invalid JSON, oversized responses, absent success/context fields,
and wrong hostname/action all fail closed. No mutation should follow these results.

Retries default to zero; `retries: 1` or `2` enables bounded immediate attempts for
network failures, HTTP 429/5xx, and provider `internal-error`. All attempts in one
verification use one server-generated Siteverify idempotency key. Rejections,
malformed responses, and expired/reused tokens are not retried. A retryable result
indicates a transient verification failure, not permission to reuse a token.

Siteverify idempotency does not make application mutations exactly once. Use your
own persisted mutation idempotency policy when clients retry after an uncertain
response. Acquire a fresh widget token for a new submission and do not authorize
from a prior client success event.

## Local tests

Use an injected `fetch` for deterministic server tests. Return a Siteverify response
with both the configured hostname and action; never replace verification with a
client flag. The package tests simulate pass, rejection, expiry/reuse, context
mismatch, network failure, malformed responses, deadlines, and bounded retries.

Cloudflare provides a public passing sitekey `1x00000000000000000000AA` and matching
test secret `1x0000000000000000000000000000000AA`. A spent-token test secret is
`3x0000000000000000000000000000000AA`. Dummy tokens require test secrets; production
secrets reject them. Keep test keys separate from production configuration and
configure the expected test hostname/action to match the returned context. See
[Cloudflare testing guidance](https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
