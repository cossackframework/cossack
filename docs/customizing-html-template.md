---
title: "Customizing the HTML Template"
description: "Set the HTML document structure with the htmlTemplate option."
---

# Customizing the HTML Template

Cossack generates a standard HTML document for server-rendered pages. Pass an `htmlTemplate` option to `createApp()` to set the document structure, support right-to-left languages, add `<body>` attributes, or include scripts.

## Usage

### Function Template

Pass a function that receives helper functions and returns an HTML string:

```typescript
import { createApp } from '@cossackframework/framework/router';

const app = createApp({
    AppComponent: App,
    htmlTemplate: ({ cossackScripts, cossackBody }) => `
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
            <head>
                <meta charset="utf-8">
                ${cossackScripts()}
            </head>
            <body class="custom-class">
                ${cossackBody()}
            </body>
        </html>
    `,
});
```

### String Template

For simpler cases, pass a plain string with `{{ cossackScripts }}` and `{{ cossackBody }}` placeholders. New projects keep this string in `src/root.ts` as `export const template` and pass it to `createApp()` from `src/index.ts`:

```typescript
const app = createApp({
    AppComponent: App,
    htmlTemplate: `
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
            <head>
                <meta charset="utf-8">
                {{ cossackScripts }}
            </head>
            <body class="custom-class">
                {{ cossackBody }}
            </body>
        </html>
    `,
});
```

String templates also accept `{{ cossackLang }}`, the request's resolved locale (escaped, `en` by default), for example `<html lang="{{ cossackLang }}">`. Each placeholder is replaced once: a second occurrence of the same placeholder stays as written. A function template receives only `cossackScripts` and `cossackBody`.

## Template Helpers

Both approaches provide the same two helpers:

| Helper | Description |
| --- | --- |
| `cossackScripts()` | Returns all `<head>` content: head tags from `head()`, CSS links/styles, component styles, initial state script, module preload links, and the client entry script tag. |
| `cossackBody()` | Returns `<div id="root">${body}</div>`. The page content is wrapped in the `#root` container required for hydration. |

### What `cossackScripts()` includes

- Head tags defined by your page and layout components via `head()`. Attribute
  values are HTML-escaped. `undefined` and false boolean attributes are omitted.
  Pass ordinary strings without pre-escaping them.
- CSS stylesheet link (or inline CSS with deferred load in production). A
  production entry without a CSS asset emits no stylesheet link.
- One `<style data-cossack-style="…">` element for each component style scope
  (`static styles`) the page rendered, after the application CSS. Component
  output carries no style elements, so keep `cossackScripts()` in `<head>`.
- `window.__INITIAL_STATE__` script for client-side hydration
- Module preload links for route-specific chunks, and for the predicted
  locale chunk when the request's locale is not the default one
- The client entry `<script type="module">` tag

## Important Notes

- The `#root` container is required. Client-side hydration looks for `<div id="root">` to mount the application. If you use a function template, always include `cossackBody()` in your output. If you use a string template, include the `{{ cossackBody }}` placeholder.
- Production minification still applies. The output is minified via `minifyHtml` in production builds in both template modes. Minification does not change how the page renders: whitespace between tags collapses to one space (or one line break) and is removed only before `<html>`, inside `<head>` and before `<body>`. The content of `<pre>`, `<textarea>`, `<script>`, `<style>` and of elements whose `style` attribute or Tailwind class (`whitespace-pre`, `whitespace-pre-wrap`, `whitespace-break-spaces`) preserves whitespace is kept as written. If a stylesheet rule preserves whitespace on an element, give it one of those classes too, or minification collapses its whitespace.
- The `<meta charset="utf-8">` tag is your responsibility. The default template includes it. Include it in your custom template as well.

## TypeScript

The `htmlTemplate` option accepts the `TemplateHelpers` type if you need explicit typing:

```typescript
import type { TemplateHelpers } from '@cossackframework/framework/root';

const app = createApp({
    htmlTemplate: (helpers: TemplateHelpers) => `
        <!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="utf-8">
                ${helpers.cossackScripts()}
            </head>
            <body>
                ${helpers.cossackBody()}
            </body>
        </html>
    `,
});
```

## Default Template

When `htmlTemplate` is not provided, the following default template is used:

```html
<!DOCTYPE html>
<html lang="en"> <!-- the request's resolved locale -->
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="icon" type="image/png" href="/favicon-96x96.png" sizes="96x96" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="shortcut icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
        <!-- cossackScripts output -->
    </head>
    <body class="antialiased">
        <!-- cossackBody output -->
    </body>
</html>
```
