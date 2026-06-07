# Plan - Customize renderRoot
Currently, in `packages/framework/src/root.ts`, we define the `renderRoot` template like so:

```ts
const raw = `
    <!DOCTYPE html>
    <html lang="en">
        <head>
            <meta charset="utf-8">
            ${headTagsHtml}
            ${cssHtml}
            ${initialStateScript}
            ${(props.modulePreloads || []).map(href => `<link rel="modulepreload" href="${href}">`).join('\n                ')}
            <script type="module" src="${clientScript}"></script>
        </head>
        <body>
            <div id="root">${props.body}</div>
        </body>
    </html>
`;
```

This template is used to render our app when user creating new app via `create-cossack-app` command too. However, what if developers want to customize this wrapper template?

At the moment, we let developer customize the wrapper `App` component like so:

```ts
const app = createApp({ AppComponent: App });
```

But this only allow customizing inside `html > body > div#root`, we cannot customize the whole html structure.

## Suggestions
Based on our structure, your suggestions are welcomed. Here are my initial thoughts:

We let them configure via `htmlTemplate`, and we replaced this complex block
```ts
${headTagsHtml}
${cssHtml}
${initialStateScript}
${(props.modulePreloads || []).map(href => `<link rel="modulepreload" href="${href}">`).join('\n                ')}
<script type="module" src="${clientScript}"></script>
```
with `{{ headScripts }}` or better `headScripts()` function.

and `${props.body}` with `{{body}}` or better `cossackBody()`

```ts
const htmlTemplate = `
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
        <head>
            <meta charset="utf-8">
            {{ headScripts }} or ${headScripts()}
        </head>
        <body class="customized-class">
            {{ body }} or ${cossackBody()}
        </body>
    </html>
`;

const app = createApp({ AppComponent: App, htmlTemplate });
```

This changes a lot inside the `router.ts` so please carefully, run tests after implemented