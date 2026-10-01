---
title: "Link"
description: "Use HTML anchor tags for navigation. Cossack handles prefetching and navigation."
---

# Link

Cossack does not need a custom `<Link>` component. Use the standard HTML `<a>` tag. Cossack handles prefetching and navigation.

This page explains the equivalent approach for developers who use other frameworks.

## How prefetching and navigation work

- A user points to or clicks an `<a>` tag.
- Cossack fetches the page data and the required page script.
- Cossack updates the page and browser history.
