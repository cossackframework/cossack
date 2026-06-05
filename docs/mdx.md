# Markdown Pages

Cossack supports `.md` and `.mdx` files as first-class page components. Any markdown file in your `src/pages` directory will be automatically transformed into a Cossack component. Following the same conventions as TypeScript page components, you can use frontmatter for metadata and the markdown content will be rendered as the component's output.

### Metadata via Frontmatter

MDX components use frontmatter to define their metadata, which is automatically fed into the framework's `head()` merging system.

```markdown
---
title: "Documentation"
description: "Learn how to use Cossack"
image: "/assets/og-image.png"
---

# Welcome

Cossack is fast!
```

The fields `title`, `description`, and `image` are automatically mapped to the corresponding properties in the component's `head()` method, allowing them to be correctly merged with layouts and the global app shell.

### Layout Support

MDX components fully support the nested layout system. If an MDX file is placed in a folder with a `layout.ts`, it will be wrapped by that layout just like a standard TypeScript component.