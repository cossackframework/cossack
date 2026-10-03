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

The following are still follow-up requirements, including for reviewed controls:
error/description and focus behavior within full application form recipes, and the
final published-runtime matrix. Type checks cannot prove correct labeling in every app.

## Component inventory

| Source | Contract audit | Evidence / next action |
| --- | --- | --- |
| [Accordion](../packages/ui/src/components/Accordion.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Alert](../packages/ui/src/components/Alert.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [AlertDialog](../packages/ui/src/components/AlertDialog.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [AspectRatio](../packages/ui/src/components/AspectRatio.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Attachment](../packages/ui/src/components/Attachment.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Avatar](../packages/ui/src/components/Avatar.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [AvatarGroup](../packages/ui/src/components/AvatarGroup.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Badge](../packages/ui/src/components/Badge.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Breadcrumb](../packages/ui/src/components/Breadcrumb.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Bubble](../packages/ui/src/components/Bubble.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Button](../packages/ui/src/components/Button.ts) | Foundation reviewed | Published type fixture, SSR tests and native-controls Chromium acceptance. |
| [ButtonGroup](../packages/ui/src/components/ButtonGroup.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Calendar](../packages/ui/src/components/Calendar.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Card](../packages/ui/src/components/Card.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Carousel](../packages/ui/src/components/Carousel.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Checkbox](../packages/ui/src/components/Checkbox.ts) | Foundation reviewed | Published type fixture, SSR tests and native-controls Chromium acceptance. |
| [Collapsible](../packages/ui/src/components/Collapsible.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Combobox](../packages/ui/src/components/Combobox.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Command](../packages/ui/src/components/Command.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [ContextMenu](../packages/ui/src/components/ContextMenu.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [DataTable](../packages/ui/src/components/DataTable.ts) | Foundation reviewed | Typed columns/props, generated Node/workerd resource/query acceptance and focus checks. |
| [DatePicker](../packages/ui/src/components/DatePicker.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Drawer](../packages/ui/src/components/Drawer.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [DropdownMenu](../packages/ui/src/components/DropdownMenu.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Empty](../packages/ui/src/components/Empty.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Field](../packages/ui/src/components/Field.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Form](../packages/ui/src/components/Form.ts) | Foundation reviewed | Published type fixture, SSR tests and native-controls Chromium acceptance. |
| [HoverCard](../packages/ui/src/components/HoverCard.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Input](../packages/ui/src/components/Input.ts) | Foundation reviewed | Published type fixture, SSR tests and native-controls Chromium acceptance. |
| [InputGroup](../packages/ui/src/components/InputGroup.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [InputOTP](../packages/ui/src/components/InputOTP.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Item](../packages/ui/src/components/Item.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Kbd](../packages/ui/src/components/Kbd.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Label](../packages/ui/src/components/Label.ts) | Foundation reviewed | Published type fixture, SSR tests and native-controls Chromium acceptance. |
| [Marker](../packages/ui/src/components/Marker.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Menubar](../packages/ui/src/components/Menubar.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Message](../packages/ui/src/components/Message.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [MessageScroller](../packages/ui/src/components/MessageScroller.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Modal](../packages/ui/src/components/Modal.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [MultiSelect](../packages/ui/src/components/MultiSelect.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [NativeSelect](../packages/ui/src/components/NativeSelect.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [NavigationMenu](../packages/ui/src/components/NavigationMenu.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Pagination](../packages/ui/src/components/Pagination.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [PasswordInput](../packages/ui/src/components/PasswordInput.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Popover](../packages/ui/src/components/Popover.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Progress](../packages/ui/src/components/Progress.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [RadioGroup](../packages/ui/src/components/RadioGroup.ts) | Foundation reviewed | Published types, SSR validation and themed keyboard/state browser acceptance. |
| [Resizable](../packages/ui/src/components/Resizable.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [ScrollArea](../packages/ui/src/components/ScrollArea.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Select](../packages/ui/src/components/Select.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Separator](../packages/ui/src/components/Separator.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Sheet](../packages/ui/src/components/Sheet.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Sidebar](../packages/ui/src/components/Sidebar.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Skeleton](../packages/ui/src/components/Skeleton.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Slider](../packages/ui/src/components/Slider.ts) | Foundation reviewed | Published types, SSR validation and themed keyboard/state browser acceptance. |
| [Spinner](../packages/ui/src/components/Spinner.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Switch](../packages/ui/src/components/Switch.ts) | Foundation reviewed | Published type fixture, SSR tests and native-controls Chromium acceptance. |
| [Table](../packages/ui/src/components/Table.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Tabs](../packages/ui/src/components/Tabs.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Textarea](../packages/ui/src/components/Textarea.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Toast](../packages/ui/src/components/Toast.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Toggle](../packages/ui/src/components/Toggle.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [ToggleGroup](../packages/ui/src/components/ToggleGroup.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Tooltip](../packages/ui/src/components/Tooltip.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |
| [Typography](../packages/ui/src/components/Typography.ts) | Pending | Audit props/spread ownership, events, naming, keyboard and focus against implementation. |

## Next passes

Next audit Textarea, Select/NativeSelect, InputGroup and PasswordInput. Audit value/checked ownership after native user edits and during SSR/hydration.
Then review composite selection and disclosure controls, dialogs/menus, navigation,
chat/display components, blocks and icons. Do not mechanically replace every prop
index signature with one global type: the actual spread destination determines the
allowed attributes, native event target and accessibility contract.

The shared types currently cover the reviewed controls. Extend them from implemented
native behavior. Preserve an explicit status for unknown or unsupported behavior in
the installed catalog rather than implying that unreviewed components are complete.
