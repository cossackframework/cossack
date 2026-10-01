---
title: "Markdown Pages"
description: "Create pages from.md and.mdx files with frontmatter metadata."
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
