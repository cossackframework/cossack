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
import { createApp } from './router';

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

For simpler cases, pass a plain string with `{{ cossackScripts }}` and `{{ cossackBody }}` placeholders:

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

## Template Helpers

Both approaches provide the same two helpers:

| Helper | Description |
| --- | --- |
| `cossackScripts()` | Returns all `<head>` content: head tags from `head()`, CSS links/styles, initial state script, module preload links, and the client entry script tag. |
| `cossackBody()` | Returns `<div id="root">${body}</div>` : the page content wrapped in the `#root` container required for hydration. |

### What `cossackScripts()` includes

- Head tags defined by your page and layout components via `head()`. Attribute
  values are HTML-escaped; `undefined` and false boolean attributes are omitted.
  Pass ordinary strings without pre-escaping them.
- CSS stylesheet link (or inline CSS with deferred load in production). A
  production entry without a CSS asset emits no stylesheet link.
- `window.__INITIAL_STATE__` script for client-side hydration
- Module preload links for route-specific chunks
- The client entry `<script type="module">` tag

## Important Notes

- **The `#root` container is required.** Client-side hydration looks for `<div id="root">` to mount the application. If you use a function template, always include `cossackBody()` in your output. If you use a string template, include the `{{ cossackBody }}` placeholder.
- **Production minification still applies.** Regardless of which template mode you use, the output is minified via `minifyHtml` in production builds.
- **The `<meta charset="utf-8">` tag is your responsibility.** The default template includes it, so make sure your custom template includes it as well.

## TypeScript

The `htmlTemplate` option accepts the `TemplateHelpers` type if you need explicit typing:

```typescript
import type { TemplateHelpers } from './root';

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
<html lang="en">
    <head>
        <meta charset="utf-8">
        <!-- cossackScripts output -->
    </head>
    <body>
        <!-- cossackBody output -->
    </body>
</html>
```
