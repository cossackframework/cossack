# Blocks

Blocks are ready-to-use, composable UI patterns for common application sections.
Each block is a self-contained set of components wired together to solve a
real-world need — think of them as the "next level up" from individual UI
components.

## Difference from Components

| | Components (`@cossackframework/ui`) | Blocks |
|---|---|---|
| Granularity | Single primitive (Button, Modal, Table) | Full section (Auth form, Dashboard, Settings) |
| Depends on | `@cossackframework/core`, `@cossackframework/renderer` | UI components + app state |
| Ejectable | `cossack add ui <name>` | Copy into `src/blocks/` and customize |
| Goal | Reusable building blocks | Opinionated starting points |

## Available Blocks

| Block | Description |
|---|---|
| **AuthForm** | Login + signup form with validation, password reveal, social buttons |
| **DashboardStat** | Stat cards grid (KPI tiles with trend indicators) |
| **SettingsPanel** | Card-section settings page (switch toggles, text inputs, action buttons) |
| **CommandPalette** | ⌘K command palette with fuzzy search + keyboard navigation |

## Planned Blocks

| Block | Description |
|---|---|
| **DataTable** | Sortable, paginated table with search filter + row actions |
| **CommentThread** | Nested comments with reply, upvote, and timestamps |

## Usage

Blocks are published from `@cossackframework/ui/blocks`. They use the
`@cossackframework/ui` component library and expect the theme CSS to be wired.

```ts
import { AuthForm } from '@cossackframework/ui/blocks';

// In a page:
render() {
    return component(AuthForm, {
        mode: 'login',
        onSubmit: async (data) => { ... },
    });
}
```

## Creating a New Block

1. Create `src/blocks/<Name>/index.ts` — the block's entry component.
2. Compose UI components + app-specific logic.
3. Export it from `src/blocks/index.ts`.
4. Document it in this README.
