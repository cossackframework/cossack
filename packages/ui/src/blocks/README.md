# Blocks

Blocks are ready-to-use UI patterns for common application sections.
Each block is a self-contained set of components for one application need.
Blocks sit one level above individual UI components.

## Difference from Components

| | Components (`@cossackframework/ui`) | Blocks |
|---|---|---|
| Granularity | Single primitive (Button, Modal, Table) | Full section (Auth form, Dashboard, Settings) |
| Depends on | `@cossackframework/core`, `@cossackframework/renderer` | UI components + app state |
| Ejectable | `cossack add ui <name>` | All four blocks have CLI entries |
| Goal | Reusable building blocks | Opinionated starting points |

## Available Blocks

| Block | Description |
|---|---|
| AuthForm | Login + signup form with validation, password reveal, explicit provider callbacks |
| DashboardStat | Stat cards grid (KPI tiles with trend indicators) |
| SettingsPanel | Card-section settings page (switch toggles, text inputs, action buttons) |
| CommandPalette | Opt-in Ctrl/Meta+K palette with grouped substring search and keyboard navigation |

The controlled `DataTable` is available from `@cossackframework/ui` as a component.
Its parent owns server queries and row actions.

## Planned Blocks

| Block | Description |
|---|---|
| CommentThread | Nested comments with reply, upvote, and timestamps |

## Usage

Blocks are published from `@cossackframework/ui/blocks`. They use the
`@cossackframework/ui` component library and expect the theme CSS to be wired.

```ts
import { component } from '@cossackframework/renderer';
import { DashboardStat, type StatItem } from '@cossackframework/ui/blocks';

const stats: readonly StatItem[] = [
    { id: 'orders', label: 'Orders', value: 0 },
    {
        id: 'errors', label: 'Errors', value: 2,
        change: '-3 this month', trend: 'down', tone: 'positive',
    },
];

export const metrics = () => component(DashboardStat, {
    stats,
    'aria-label': 'Overview metrics',
});
```

DashboardStat renders a native list of label/value definitions. Each metric needs
an ID unique within the list. Values are finite numbers or preformatted text.
Format units and dates in the caller. Change direction and favorable/unfavorable
meaning are independent. Tone defaults to neutral. Positive and negative tones
include visible meaning. Use `trendLabels` and `toneLabels` to localize it.
The grid uses one column on narrow screens, two from the `sm` breakpoint, and
`columns` (2, 3, or 4, with a default of 4) from `md`. Root attributes and events target the
`ul`. The block does not fetch data or announce updates as a live region.

AuthForm requires an instance `id` and an application-owned `onSubmit` callback.
See its installed guide for credential handling, safe errors and provider actions.

SettingsPanel requires a stable `id` and readonly sections with unique section IDs
and row keys. Use `values` plus `onValuesChange` for controlled settings, or `defaultValues`
for local state. Buttons require `action` text and `onAction`. Destructive styling
requires `variant: 'destructive'`. They are non-submit buttons. Wrap the block in
an application form for native submission/reset. A reset proposes the initial
snapshot. Controlled parents can accept or reject it. See the installed guide for
field names, disabled state, row updates and callback ownership.

## Creating a New Block

1. Create `src/blocks/<Name>/index.ts`, the file for the entry component.
2. Compose UI components and application-specific logic.
3. Export it from `src/blocks/index.ts`.
4. Document it in this README.
