---
title: "Link"
description: "Use HTML anchor tags for navigation. Cossack handles prefetching and navigation."
---

# Link

Cossack does not need a custom `<Link>` component. Use the standard HTML `<a>` tag. Cossack handles prefetching and navigation.

This page explains the equivalent approach for developers who use other frameworks.

## How prefetching and navigation work

- A user points to an `<a>` tag for 50 ms, or clicks it.
- Cossack fetches the page data and the required page script.
- Cossack updates the page and browser history.

The browser handles a link itself when the link is not a same-origin `http(s)` URL, its `href` starts with `#`, it has a `target` or `download` attribute, the click uses a modifier key or a button other than the main one, or a handler called `preventDefault()`. A link to a functional API route (such as `/feed.xml`) loads as a document and is never prefetched.

Two attributes change one link's navigation:

- `data-scroll="auto|top|preserve"` sets its scroll policy. See [View Transitions](./view-transitions.md#navigation-scroll-behavior).
- `data-transition-types="nav-forward"` sets its View Transition types. See [View Transitions](./view-transitions.md#per-link-transition-types).

To navigate from code, use `await this.navigate(url, options)` in a client method. See [Prevent Navigation](./prevent-navigation.md#navigation-completion-contract).
