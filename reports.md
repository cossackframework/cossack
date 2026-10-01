# Cossack Framework — Bug Reports & Feature Requests

Reports filed from downstream apps. Each entry notes where the limitation was
hit and whether a workaround is currently in place.

---

## CSM-001: `Accordion` clips dynamically-growing and pop-out content

- **Type:** Limitation / feature request
- **Component:** `@cossackframework/ui` → `Accordion` (`packages/ui/src/components/Accordion.ts`)
- **Found in:** `new-storm-matching` — outreach filter card (`src/pages/dashboard/outreach/index.ts`)

### Problem

The accordion animates open/close by clamping its content wrapper to a
`max-height` measured **once in `onMount`** (single `requestAnimationFrame`
read of `scrollHeight`), with the wrapper permanently set to
`overflow: hidden`:

```ts
const contentWrapperStyle = `max-height: ${open ? targetHeight + "px" : "0"}; ...`;
// <div class="cs-accordion__content-wrapper overflow-hidden" style=...>
```

Two consequences for real-world content:

1. **Absolutely-positioned pop-outs are clipped.** An address-autocomplete
   dropdown (`absolute`, ~288px tall) rendered inside the content is cut off
   at the wrapper's bottom edge, even when the accordion is fully open —
   `overflow: hidden` applies in the resting open state too, not just during
   the animation.
2. **Content that grows after mount is clipped.** Because the height is only
   measured in `onMount`, anything that appears later (async data, error
   messages, conditionally rendered rows) extends past the clamp and gets
   cut off.

### Requested behavior

Either or both:

- Re-measure content height when it changes (e.g. `ResizeObserver` on the
  content element), so the clamp always matches actual content height.
- Overflow should be `visible` in the resting open state (clipping only
  needed while animating), allowing pop-out overlays like combobox
  suggestion lists to escape the content area.

### Current workaround (downstream)

A scoped `:has()` CSS override in the app lifts the clamp only while the
autocomplete dropdown/error is visible:

```css
.cs-accordion__content-wrapper:has(#outreach-address-suggestions, #outreach-autocomplete-error) {
  max-height: none !important;   /* inline-style override requires !important */
  overflow: visible;
}
```

This keeps open/close animations intact for normal toggling but is
per-instance glue the app has to maintain.
