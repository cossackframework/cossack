# Plan - Add title and descriptions to docs
Currently, all of documentations under `/docs` do not have title and description. We should add them to improve SEO and provide better context for readers.

## Proposed Changes

For each documentation file, we should add a frontmatter section at the top with the `title` and `description` fields. The `title` should be a concise, the best is using the first heading (h1) of the markdown file. The `description` should be a brief summary of the content, ideally one or two sentences.

---
title: "Pages"
description: "The @Page decorator is used to mark a class as a Cossack component and configure its behavior, routing, and transport."
---

Please loop through all the documentation files and add the frontmatter section with appropriate title and description. Use the fast, cheap model to generate.