# @cossackframework/renderer

A minimal, performant, and modern rendering library for client, server, and edge environments. Inspired by lit-html, it supports server-side rendering (SSR) and client-side hydration.

## Installation

You can install the package using pnpm, npm, or yarn:

```bash
# pnpm
pnpm add @cossackframework/renderer

# npm
npm install @cossackframework/renderer

# yarn
yarn add @cossackframework/renderer
```

## Client-Side Usage

For client-side rendering, import `html` and `render` from the main package entry point.

```typescript
import { html, render } from '@cossackframework/renderer';

const app = (name: string) => html` <h1>Hello, ${name}!</h1> `;

const container = document.getElementById('app');
if (container) {
  render(app('World'), container);
}
```

## Server-Side Usage

For server-side rendering, import `html` and `renderToString` from the `/server` entry point. This ensures that client-side, DOM-dependent code is not bundled in your server-side code.

```typescript
import { html, renderToString } from '@cossackframework/renderer/server';

const app = (name: string) => html` <h1>Hello, ${name}!</h1> `;

const htmlString = renderToString(app('World'));
console.log(htmlString); // Output: <h1>Hello, World!</h1>
```

## API

### `html`

A template tag function that creates a `TemplateResult` object.

### `render(template: TemplateResult, container: Element | DocumentFragment)`

Renders a `TemplateResult` to a DOM container on the client-side.

### `renderToString(template: TemplateResult): string`

Renders a `TemplateResult` to a string on the server-side.

### `renderToReadableStream(template: TemplateResult): ReadableStream<Uint8Array>`

Renders a `TemplateResult` to a `ReadableStream` on the server-side, suitable for streaming environments like Cloudflare Workers or Deno.

## Tree-shaking

The library is designed to be tree-shakable. By providing separate entry points for client-side (`@cossackframework/renderer`) and server-side (`@cossackframework/renderer/server`) rendering, you can ensure that only the code needed for your environment is included in your final bundle.
# renderer
