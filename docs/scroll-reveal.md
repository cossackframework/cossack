---
title: 'Scroll Reveal'
description: 'Reveal elements on scroll with a framework-provided helper that also handles dynamically-added nodes (tabs, filters, modals).'
---

# Scroll Reveal

`setupScrollReveal()` (from `@cossackframework/framework/client`) adds a class
to elements when they scroll into view — the classic "reveal on scroll" effect.

Unlike a hand-rolled `IntersectionObserver` that only runs once, this helper
**also watches the DOM for elements added later** (tab switches, filters,
modals, async content) and reveals them too. This avoids the common bug where
newly-rendered reveal elements get stuck invisible.

## Usage

Call it from your global `App` component's lifecycle hooks:

> Import from `@cossackframework/framework/scroll-reveal` (the isolated entry).
> The `@cossackframework/framework/client` barrel pulls in the client app graph
> (which depends on Vite's virtual modules) and cannot be imported from code
> loaded during `cossack ssg` — such as your `App`.

```typescript
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { setupScrollReveal } from '@cossackframework/framework/scroll-reveal';

@Page({ transport: 'http' })
export class App extends Cossack {
  private cleanupReveal?: () => void;

  onMount() {
    this.cleanupReveal = setupScrollReveal();
  }

  onCleanup() {
    this.cleanupReveal?.();
  }

  render() {
    return html`<div>${this.children}</div>`;
  }
}
```

Mark elements in any page/layout:

```html
<div class="scroll-reveal">I fade in when scrolled into view.</div>
```

With this CSS:

```css
.scroll-reveal {
  opacity: 0;
  transform: translateY(30px);
  transition:
    opacity 0.6s,
    transform 0.6s;
}
.scroll-reveal.revealed {
  opacity: 1;
  transform: translateY(0);
}
```

## Options

```typescript
setupScrollReveal({
  selector: '.scroll-reveal', // elements to reveal
  revealedClass: 'revealed', // class added on reveal
  threshold: 0.1, // IntersectionObserver threshold
  rootMargin: '0px 0px -50px 0px',
  once: true, // reveal once (default); false toggles on leave
});
```

The helper returns a cleanup function that disconnects both observers — call it
in `onCleanup()`.
