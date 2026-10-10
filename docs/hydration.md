---
title: "Hydration diagnostics"
description: "Locate development SSR hydration mismatches without logging rendered values or private state."
---

# Hydration diagnostics

Hydration connects a client component to its server-rendered HTML. Matching
markup keeps existing DOM nodes and attaches their listeners. A structural
mismatch requires the renderer to rebuild that boundary. A text mismatch can
be reconciled in place.

In development, the browser reports a structured warning with
`event: 'cossack.hydration.mismatch'`. Inspect its component, source, path,
category and action. Source locations use the application's relative source
path. Diagnostics describe node shapes or state types; they do not include
rendered text, state values or full serialized state.

| Category | Meaning | Action |
| --- | --- | --- |
| `text-content` | Server text differs from the first client render | `text-reconcile` |
| `element-tag`, `node-type`, and other structural categories | The renderer cannot adopt the server node sequence | `full-render-fallback` |
| `state-type` | Hydrated public state has a different type from its declared initializer | `inspect-public-state-contract` |

A state diagnostic names the affected path, such as `public.count`, and the
expected and actual types. Check the server's initialization and serialization,
then check the client declaration. This is a development hint based on the
initializer, not runtime type validation. A declared union can legitimately change
shape; nullable and custom-class values are not compared. Text diagnostics identify the DOM path.
When you supply an interpolation field map, they can also identify its state
path. The framework does not guess a field name from rendered text.

## Expected client-only differences

For an intentional client-only boundary, override its metadata getter:

```ts
class BrowserOnlyStatus extends Cossack {
  get hydrationMetadata() {
    return { ...super.hydrationMetadata, expectedClientOnly: true };
  }
}
```

This suppresses warnings for that boundary and its subtree. It still reconciles
or rebuilds mismatched markup. Keep suppression on the smallest intentional
boundary so unrelated mismatches remain visible.

For direct renderer use, the third argument of
`hydrate(template, container, metadata)` accepts component identity, relative
source location, a state path, an interpolation `fields` map and
`expectedClientOnly`. These hints explain ownership; they do not validate
application state or change hydration behavior.

## Verify hydration behavior

Use real browser tests to preserve an SSR node reference through initial
hydration, click once and assert one effect, and count server resource calls.
Nested components and retained layouts need their own assertions: navigation
should retain the owning layout's service instance while child pages change.
See [Test utilities](./test-utils.md) for hydration-state parsing and component
simulation. DOM simulation cannot replace generated application/browser tests.

Production excludes diagnostic warnings and source metadata. Hydration still
reconciles markup; it does not publish debug state or absolute project paths.
