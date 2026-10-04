# UI contract audit for 0.9.0

Author: Codex. Updated 2026-10-04. This inventory supports RT-23; it does not close the task.

Every component needs declared native attribute ownership, typed events, label guidance,
keyboard/focus review and appropriate browser evidence. Existing tests remain useful,
but a pending row means this contract audit is incomplete. Files with multiple exported
components include all of those exports. Blocks and icons need a separate final pass.

## Reviewed foundation

Button, Input, Label, Checkbox, Switch and Form now use shared native attribute/event
types. `component()` preserves closed prop types instead of adding an arbitrary index
signature. Data/ARIA attributes have explicit contracts. Checkbox consumes its label
prop and emits checked once. Switch renders label children and updates the native
checked property after parent state changes. Sample forms now use boolean disabled
flags, matching label IDs and the third component argument for button children.

Public declaration tests exercise valid directives/events and reject misspelled props,
incorrect event types and competing controlled state. Chromium tests native labels,
keyboard toggles, validation, disabled controls, event targets, controlled reset and
FormData. Installed guide/catalog acceptance is recorded in the release verification log.

The Chromium fixture now builds the real Tailwind/UI theme. It verifies light/dark
disabled opacity/cursors, inherited fieldsets and a keyboard-visible Switch focus ring.
Checkbox/Switch/RadioGroup wrappers match their actual child input's disabled state.
Slider matches its own native disabled state. This is focused style acceptance, not
a complete contrast, layout or cross-browser audit.

RadioGroup and Slider now have typed props/events. RadioGroup updates checked
properties, keys items by unique values, and passes form/required/disabled to inputs.
Slider applies numeric bounds before a live value binding, including recovery when
widened bounds admit a previously clamped requested value. Browser checks exercise
keyboard changes, parent resets, callback targets and retained radio DOM identity.

Textarea, Select and NativeSelect now have native prop/event contracts. Their `.value`
bindings render as textarea text or selected options before JavaScript runs. Chromium
verifies retained controls/options, leading newlines, escaped text, keyboard input,
required/disabled behavior and FormData. Null/undefined values serialize as empty
text. Unmatched single-select values cannot encode `selectedIndex=-1` in static
HTML; use a matching option for SSR. Interpolated textarea children remain unsupported.
A browser-specific renderer entry keeps the SSR parser out of normal UI bundles.
Deliberate browser serialization uses `@cossackframework/renderer/server`.

InputGroup and PasswordInput now have native input contracts. InputGroup consumes
its adornments and derives wrapper error styles from the input. PasswordInput consumes
callbacks and settings without duplicate attributes, composes onChange with native
input listeners, and disables its reveal button with the field. Pointer reveal
preserves field focus/selection; keyboard reveal retains button focus. Public types
also cover string ARIA ID references while rejecting DOM reflection property names.

The following are still follow-up requirements, including for reviewed controls:
error/description and focus behavior within full application form recipes, and the
final published-runtime matrix. Type checks cannot prove correct labeling in every app.

## Component inventory

| Source | Contract audit | Evidence / next action |
| --- | --- | --- |
| [Accordion](../packages/ui/src/components/Accordion.ts) | Reviewed foundation | Typed root/trigger/panel contracts, native activation, stable IDs, one-time defaults, focus restoration and SSR/Chromium acceptance. |
| [Alert](../packages/ui/src/components/Alert.ts) | Reviewed foundation | Typed div events/attributes, independent announcement urgency, decorative icons, focus-preserving updates, SSR/Chromium and ejected-source coverage. |
| [AlertDialog](../packages/ui/src/components/AlertDialog.ts) | Reviewed foundation | Typed native dialog props, linked title/message, Cancel-first focus, controlled/default dismissal, caller-owned actions and SSR/Chromium acceptance. |
| [AspectRatio](../packages/ui/src/components/AspectRatio.ts) | Reviewed foundation | Typed native wrapper, positive finite ratios, independent CSS ratio box, responsive width/ratio changes, SSR/no-JavaScript/Chromium and ejected-source coverage. |
| [Attachment](../packages/ui/src/components/Attachment.ts) | Reviewed foundation | Required filename, typed div/button/image targets, explicit localized status, native removal cancellation/disabled behavior, decorative previews, narrow/RTL layout and SSR/Chromium/ejection/installed guidance. |
| [Avatar](../packages/ui/src/components/Avatar.ts) | Reviewed foundation | Typed span/image callbacks, explicit alternative text, stable fallback names, request-owned failure and cached hydration recovery, native style composition, SSR/Chromium and source-ejection coverage. |
| [AvatarGroup](../packages/ui/src/components/AvatarGroup.ts) | Reviewed foundation | Named native group, readonly stable keyed items, native props, validated geometry/counts, localized overflow, RTL/reverse overlap, keyed state retention, SSR/Chromium and source-ejection coverage. |
| [Badge](../packages/ui/src/components/Badge.ts) | Reviewed foundation | Typed native span attributes/events, validated variants, readable status text, SSR/Chromium and ejected-source coverage. |
| [Breadcrumb](../packages/ui/src/components/Breadcrumb.ts) | Reviewed foundation | Typed native root/list/link/text targets, stable readonly items, current-page links/text, rich names, hidden separators, native keyboard/modifiers, keyed focus, SSR/accessibility snapshots/Chromium, scaffold and ejected-source coverage. |
| [Bubble](../packages/ui/src/components/Bubble.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Button](../packages/ui/src/components/Button.ts) | Reviewed foundation | Published type fixture, SSR tests and native-controls Chromium acceptance. |
| [ButtonGroup](../packages/ui/src/components/ButtonGroup.ts) | Reviewed foundation | Named typed native div, consumed props, direct-control border joining, RTL/vertical layout, focus rings and ordinary native child behavior; SSR/Chromium and ejected-source coverage. |
| [Calendar](../packages/ui/src/components/Calendar.ts) | Reviewed foundation | Strict UTC Gregorian dates, typed root props, SSR selected month, bounded grid keyboard navigation, controlled/default values, locale/week starts and focus ownership. |
| [Card](../packages/ui/src/components/Card.ts) | Reviewed foundation | All four exports have typed native div contracts; visual-only hover, root/slot padding, native child actions, reduced motion, SSR/Chromium and ejected-source coverage. |
| [Carousel](../packages/ui/src/components/Carousel.ts) | Reviewed foundation | Named keyed slides, native root/viewport/slide targets, full/compact sizing, actual scroll boundaries, keyboard/RTL, native handler veto, focus recovery and owned resize/direction observers; SSR/Chromium/ejection coverage. |
| [Checkbox](../packages/ui/src/components/Checkbox.ts) | Reviewed foundation | Published type fixture, SSR tests and native-controls Chromium acceptance. |
| [Collapsible](../packages/ui/src/components/Collapsible.ts) | Reviewed foundation | Typed root/trigger/panel contracts, native activation, stable IDs, one-time defaults, focus restoration and SSR/Chromium acceptance. |
| [Combobox](../packages/ui/src/components/Combobox.ts) | Reviewed foundation | Stable IDs, typed input props/events, listbox/active-descendant semantics, controlled/default selection, form values, required/reset behavior, keyboard/pointer and SSR/fresh-render acceptance. |
| [Command](../packages/ui/src/components/Command.ts) | Reviewed foundation | Typed native dialog, labeled search/list, stable active IDs, controlled/default state, deterministic shortcuts, SSR/Chromium and app navigation acceptance. |
| [ContextMenu](../packages/ui/src/components/ContextMenu.ts) | Reviewed foundation | Stable IDs, typed actions/native events, menu semantics, keyboard/typeahead, disabled actions, focus restoration, bounded placement and SSR/Chromium acceptance. |
| [DataTable](../packages/ui/src/components/DataTable.ts) | Reviewed foundation | Typed columns/props, generated Node/workerd resource/query acceptance and focus checks. |
| [DatePicker](../packages/ui/src/components/DatePicker.ts) | Reviewed foundation | Shared Calendar, typed native date input, min/max/required/form/reset behavior, stable labels, controlled/default values, nonmodal popup focus and browser acceptance. |
| [Drawer](../packages/ui/src/components/Drawer.ts) | Reviewed foundation | Typed native dialog attributes/events, controlled/default state, native dismissal and modal focus; SSR/hydration and themed Chromium acceptance. |
| [DropdownMenu](../packages/ui/src/components/DropdownMenu.ts) | Reviewed foundation | Stable IDs, typed actions/native events, menu semantics, keyboard/typeahead, disabled actions, focus restoration, bounded placement and SSR/Chromium acceptance. |
| [Empty](../packages/ui/src/components/Empty.ts) | Reviewed foundation | Typed native div props/events now forwarded, visible content and caller-owned illustrations/actions, SSR/Chromium and ejected-source coverage. |
| [Field](../packages/ui/src/components/Field.ts) | Reviewed foundation | Required linked control callback, typed native div props, stable hint/error IDs, native required/invalid state, generated login rendering, SSR/Chromium and ejected-source coverage. |
| [Form](../packages/ui/src/components/Form.ts) | Reviewed foundation | Published type fixture, SSR tests and native-controls Chromium acceptance. |
| [HoverCard](../packages/ui/src/components/HoverCard.ts) | Reviewed foundation | Typed native ownership, stable names/descriptions, hover/focus persistence, Escape cancellation, cleanup, bounded placement and SSR/Chromium acceptance. |
| [Input](../packages/ui/src/components/Input.ts) | Reviewed foundation | Published type fixture, SSR tests and native-controls Chromium acceptance. |
| [InputGroup](../packages/ui/src/components/InputGroup.ts) | Reviewed foundation | Published native contracts, SSR/hydration, themed keyboard/focus/state/validation browser evidence. |
| [InputOTP](../packages/ui/src/components/InputOTP.ts) | Reviewed foundation | One labeled native field, typed props/events, controlled/default values, selection-aware paste, composition, completion, reset, validation, themed focus and SSR/hydration browser acceptance. |
| [Item](../packages/ui/src/components/Item.ts) | Reviewed foundation | Typed native div props, visual-only hover, native child actions, reduced motion, slot ownership, SSR/Chromium and source-ejection coverage. |
| [Kbd](../packages/ui/src/components/Kbd.ts) | Reviewed foundation | Typed native HTMLElement attributes/events on descriptive kbd markup, no implicit shortcut behavior, SSR/Chromium and ejected-source coverage. |
| [Label](../packages/ui/src/components/Label.ts) | Reviewed foundation | Published type fixture, SSR tests and native-controls Chromium acceptance. |
| [Marker](../packages/ui/src/components/Marker.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Menubar](../packages/ui/src/components/Menubar.ts) | Reviewed foundation | Named scoped menus, typed root/trigger/panel contracts, roving focus, RTL/typeahead, native dismissal, dynamic focus recovery, bounded positioning, SSR/Chromium and ejected-source compilation. |
| [Message](../packages/ui/src/components/Message.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [MessageScroller](../packages/ui/src/components/MessageScroller.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Modal](../packages/ui/src/components/Modal.ts) | Reviewed foundation | Typed native dialog attributes/events, controlled/default state, native dismissal and modal focus; SSR/hydration and themed Chromium acceptance. |
| [MultiSelect](../packages/ui/src/components/MultiSelect.ts) | Reviewed foundation | Typed input props/events, stable IDs, controlled/default tags, repeated form values, visible validation, keyboard/chip focus, composition, external form reset and SSR/fresh-render acceptance. |
| [NativeSelect](../packages/ui/src/components/NativeSelect.ts) | Reviewed foundation | Published native props/events, escaped SSR values, retained hydration and Chromium labels/keyboard/validation/FormData. |
| [NavigationMenu](../packages/ui/src/components/NavigationMenu.ts) | Reviewed foundation | Named native navigation, stable section/link identities, typed attribute targets, focus-safe hover/click, native Tab/links, touch, disabled fieldsets, keyed recovery, bounded panels, cleanup, SSR/Chromium and ejected-source compilation. |
| [Pagination](../packages/ui/src/components/Pagination.ts) | Reviewed foundation | Typed controlled buttons/native links, localized names, safe bounded ranges, empty/stale counts, native Tab/modifiers, keyed focus, disabled targets, SSR/Chromium, scaffold consumers and ejected-source compilation. |
| [PasswordInput](../packages/ui/src/components/PasswordInput.ts) | Reviewed foundation | Published native contracts, SSR/hydration, themed keyboard/focus/state/validation browser evidence. |
| [Popover](../packages/ui/src/components/Popover.ts) | Reviewed foundation | Stable IDs, typed trigger/panel contracts, native accessibility and dismissal, nested-scroll/resize positioning, disabled fieldsets, SSR/hydration and Chromium acceptance. |
| [Progress](../packages/ui/src/components/Progress.ts) | Reviewed foundation | Required name, unknown versus determinate values, validated ranges, owned ARIA, human-readable values, reduced motion, native div events, SSR/Chromium and ejected-source coverage. |
| [RadioGroup](../packages/ui/src/components/RadioGroup.ts) | Reviewed foundation | Published types, SSR validation and themed keyboard/state browser acceptance. |
| [Resizable](../packages/ui/src/components/Resizable.ts) | Reviewed foundation | Explicit typed panels/handle, stable defaults and controlled percentages, native separator semantics, keyboard/RTL, mouse/touch capture, endpoint focus and interruption cleanup; SSR/themed Chromium/ejection coverage. |
| [ScrollArea](../packages/ui/src/components/ScrollArea.ts) | Reviewed foundation | Single named viewport, typed native props/events, keyboard scrolling in both axes, numeric/CSS sizing, SSR/hydration and ejection coverage. |
| [Select](../packages/ui/src/components/Select.ts) | Reviewed foundation | Published native props/events, escaped SSR values, retained hydration and Chromium labels/keyboard/validation/FormData. |
| [Separator](../packages/ui/src/components/Separator.ts) | Reviewed foundation | Orientation-specific hr/div native types, textual decorative ARIA states, static separator ownership, one-pixel geometry, SSR/Chromium and ejected-source coverage. |
| [Sheet](../packages/ui/src/components/Sheet.ts) | Reviewed foundation | Typed native dialog attributes/events, controlled/default state, native dismissal and modal focus; SSR/hydration and themed Chromium acceptance. |
| [Sidebar](../packages/ui/src/components/Sidebar.ts) | Reviewed foundation | Named native navigation/disclosures, stable item identity, typed native targets, manual group state, reachable icon-rail links, offcanvas focus return, modifier-aware callbacks; SSR/Chromium/ejection and demo-shell coverage. |
| [Skeleton](../packages/ui/src/components/Skeleton.ts) | Reviewed foundation | Typed decorative div with separate rectangle/circle dimensions, native style composition, visible SSR defaults, reduced motion, public types, themed Chromium and ejected-source coverage. |
| [Slider](../packages/ui/src/components/Slider.ts) | Reviewed foundation | Published types, SSR validation and themed keyboard/state browser acceptance. |
| [Spinner](../packages/ui/src/components/Spinner.ts) | Reviewed foundation | Typed native SVG props/events, validated geometry, decorative/status states, SVG title namespace and updates, reduced motion, SSR/Chromium and ejected-source coverage. |
| [Switch](../packages/ui/src/components/Switch.ts) | Reviewed foundation | Published type fixture, SSR tests and native-controls Chromium acceptance. |
| [Table](../packages/ui/src/components/Table.ts) | Reviewed foundation | All six exports typed; separate table/wrapper targets, native cell metadata, captions and section composition, working stripes, themed hydration and child-action coverage. |
| [Tabs](../packages/ui/src/components/Tabs.ts) | Reviewed foundation | Typed root/list contracts, controlled/default state, scoped IDs, rich-label names, RTL/manual navigation, keyed focus and responsive indicator browser acceptance. |
| [Textarea](../packages/ui/src/components/Textarea.ts) | Reviewed foundation | Published native props/events, escaped SSR values, retained hydration and Chromium labels/keyboard/validation/FormData. |
| [Toast](../packages/ui/src/components/Toast.ts) | Reviewed foundation | Browser-only writes/subscriptions, immutable bounded isolated stores, single presenter ownership, paused/cancelled timers, one polite announcer, native dismissal and focus recovery; SSR/Chromium/ejection coverage. |
| [Toggle](../packages/ui/src/components/Toggle.ts) | Reviewed foundation | Typed native button attributes/events, controlled/default pressed state, click veto, native fieldsets and SSR/themed Chromium acceptance. |
| [ToggleGroup](../packages/ui/src/components/ToggleGroup.ts) | Reviewed foundation | Named native button group, mode-specific public types, SSR/default capture, immutable selection proposals, roving focus, RTL/vertical navigation, keyed focus repair and responsive indicator cleanup. |
| [Tooltip](../packages/ui/src/components/Tooltip.ts) | Reviewed foundation | Typed native ownership, stable names/descriptions, hover/focus persistence, Escape cancellation, cleanup, bounded placement and SSR/Chromium acceptance. |
| [Typography](../packages/ui/src/components/Typography.ts) | Reviewed foundation | Six native prop branches for all thirteen variants, exclusive quote/list attributes, native marker types, typed event targets, SSR/Chromium and source-ejection coverage. |

## Next passes

Next audit Bubble, then Marker, Message and MessageScroller. Bubble ignores root
native props and puts its 75% content width inside an unsized wrapper. Define
native targets, reaction text/naming, timestamp semantics and RTL geometry; retain
native child actions. Verify standalone and Message composition in a real browser.
Marker needs native root props and decorative divider semantics. Message ignores
root props and drops sent metadata. MessageScroller needs viewport ownership,
scroll/focus contracts and cleanup for scheduled work. Blocks and icons follow.

Continue the pending display, layout and chat components, then review blocks and
icons separately. Do not mechanically replace every prop index signature with a
global type: the actual spread destination determines allowed attributes, native
event targets and accessibility contracts. Keep unknown or unsupported behavior
explicit in installed catalogs. Reviewed foundations still need the broader
RT-23 generated-app acceptance and full release matrix.

The [verification log](./release-0.9.0.md#verification-log) retains completed
component evidence, including shared dialog, menu and disclosure controllers.
