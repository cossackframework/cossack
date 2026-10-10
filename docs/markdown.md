---
title: "Markdown Pages"
description: "Create pages from Markdown and MDX files with frontmatter metadata."
---

# Markdown Pages

Use `.md` and `.mdx` files as page components. Cossack turns files in `src/pages` into components. Add frontmatter to set metadata. Cossack renders the Markdown content as the page output.

### Metadata via Frontmatter

Use frontmatter to set metadata for an MDX component. Cossack adds these values to the `head()` merge.

```markdown
---
title: "Documentation"
description: "Learn how to use Cossack"
image: "/assets/og-image.png"
---

# Welcome

Cossack is fast!
```

The framework maps `title`, `description`, and `image` to the matching properties in `head()`. It merges them with values from layouts and the global app.

### Layout Support

MDX components support nested layouts. If an MDX file is in a folder with `layout.ts`, that layout wraps the page, as it does for a TypeScript component.


### Typed metadata

The built-in processor validates frontmatter before it generates HTML. A build
error names the field and its source file, line, and column. The diagnostic
includes the expected shape, without the rejected value or parser exception.
Unknown fields need an explicit extension validator.

| Field | Accepted value | Purpose |
| --- | --- | --- |
| `title` | String | Page title |
| `description` | String | Description metadata |
| `image` | String | Head image metadata |
| `author` | String | Author byline |
| `date` | ISO calendar date string, `YYYY-MM-DD` | Date byline |
| `locale` | Language tag such as `en` or `fr-CA` | Page render locale |
| `canonical` | HTTP(S) URL or root-relative path | Canonical page URL |
| `aliases` | Array of static root-relative paths | Additional static HTML outputs |
| `ssg` | Boolean | Enables static output. Defaults to true for Markdown |

Quote dates in YAML. An invalid date such as `2023-02-29` fails validation.
Canonical URLs cannot contain credentials or fragments. Alias paths cannot
contain parameters, query strings, fragments, traversal segments, backslashes,
or percent-encoded segments. Use literal output paths for aliases. Duplicate
aliases such as `/guide` and `/guide/` are rejected.
Aliases require static generation. They produce additional static files with the
same canonical URL. They do not register runtime redirects or new router routes.

Use this public type for authored metadata objects:

```ts
import type { MarkdownFrontmatter } from '@cossackframework/framework/markdown-processor';

const metadata = {
  title: 'Guide',
  date: '2026-10-05',
  locale: 'fr',
  canonical: '/fr/guide',
  aliases: ['/fr/getting-started'],
} satisfies MarkdownFrontmatter;
```

### Application metadata extensions

Declare each additional field and validate it in a reusable processor. Standard
fields keep their built-in validation and cannot be overridden.

```ts
import { createMarkdownProcessor } from '@cossackframework/framework/markdown-processor';
import { cossackPages } from '@cossackframework/framework/vite-plugin';

type GuideMetadata = { readingMinutes: number };
const markdownProcessor = createMarkdownProcessor<GuideMetadata>({
  extensions: {
    readingMinutes: (value): value is number =>
      typeof value === 'number' && Number.isFinite(value) && value > 0,
  },
});

// Use this processor in your existing Vite plugin configuration.
const pages = cossackPages({ markdownProcessor });
```

Extension values remain optional unless your processor requires them separately.
The declared type is available as `MarkdownFrontmatter<GuideMetadata>` and on the
processor result. Validators receive parsed values. A false result or thrown
exception fails the build with a value-free diagnostic.

A custom Markdown processor can call `validateMarkdownFrontmatter` with the
same `extensions` option before returning its result. The validator returns a
frozen metadata object and frozen aliases. Preserve that validated object when
returning it. The configured processor also exposes its validators through the
readonly `frontmatterExtensions` property, so the Vite and SSG module graphs can
validate the same extension contract. Custom processors with extension fields
must expose that property too. The processor does not render extension fields
in the document automatically.

### Locale pages and output identity

Place distinct locale pages at distinct source routes, such as
`src/pages/en/guide.md` and `src/pages/fr/guide.md`, and give each an explicit
`locale` and canonical URL. The locale must have a configured catalog. Each page
renders in its own locale and configuration scope, including its layouts.
Frontmatter does not translate the Markdown body. Author that body in the chosen
language.

Markdown and TypeScript pages use the same route model. A content route, static
parameter variant, or alias cannot publish the same output file as another page.
A validation failure prevents partial HTML and sitemap publication. Locale
aliases retain their owner's language and canonical metadata. The sitemap lists
each canonical URL once and excludes duplicate alias URLs.

Markdown supports trusted raw HTML. Frontmatter validation is not HTML sanitization.
Use a custom processor if your application accepts untrusted content.
