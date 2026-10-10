# Turnstile

Use `Turnstile` from `@cossackframework/ui` inside your form:

```ts
component(Turnstile, {
  id: 'contact-verification',
  siteKey: '1x00000000000000000000AA',
  action: 'contact',
  resetKey: this.challengeVersion,
  onTokenChange: token => this.form.setFieldValue('turnstileToken', token),
})
```

Only the site key is public. Never pass a secret key to a component. A client success event supplies a token, not authorization. Verify the token on the server, check the expected hostname and action, and reject before changing data. A forged client callback must grant nothing.

The component owns an empty hidden `cf-turnstile-response` field for native form transport. `responseFieldName` changes its name. RPC forms should copy `onTokenChange` into their controller. This callback receives an empty string on reset, expiry, error, and disposal. Never log tokens. `onSuccess(token)`, `onExpired()`, and `onError(error)` supply separate events. Errors contain a bounded `code`; a six-digit provider identifier may appear as `providerCode`. SDK exception messages and token values never appear in the error UI.

Increment `resetKey` after each submitted verification attempt to allow another submission. Cloudflare tokens expire after five minutes and are single-use. The public `reset()` method removes and recreates the widget, invalidating callbacks from the previous challenge. Failure and expiry expose a keyboard-accessible retry button and a live status message. `label` changes the group label. Give each instance a unique `id`. Optional `theme` accepts `auto`, `light`, or `dark`; `size` accepts `normal`, `compact`, or `flexible`; `language` is passed to Cloudflare. `action` accepts 1–32 letters, digits, underscores, or hyphens.

SSR emits inert markup and the empty response field. The default browser loader shares one official explicit-render script per document. A failed script can be retried. Disposing one component cancels its pending load and invalidates callbacks without cancelling another widget's load. Configure CSP using the [official guidance](https://developers.cloudflare.com/turnstile/reference/content-security-policy/).

For deterministic tests, inject `loadClient(document, signal)` returning a `TurnstileClient`: `render(container, options): string` and `remove(widgetId): void`. The options provide callbacks and disable the SDK's response field because the component owns it. This provider is not a security boundary. Production should use the default loader.

Visible dummy sitekeys: `1x00000000000000000000AA` always passes; `2x00000000000000000000AB` always fails; `3x00000000000000000000FF` forces interaction. They work on localhost. Use corresponding server test secrets: production secrets reject dummy tokens and test secrets reject real tokens. Use dummy keys or a mocked official script for browser automation.

See [widget options](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/), [test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/), and [server verification](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
