# Cossack Skills

Agent Skills for working with the [Cossack Framework](https://github.com/cossackframework/cossack) — a full-stack TypeScript framework where a single component class runs on both server and client.

These skills teach AI coding assistants (Claude Code, Open Code, and any Agent Skills-compatible tool) the framework's conventions and built-in features, so the assistant reaches for `@Validate`, `Image()`, `this.loading`, `@Ref()`, etc. instead of reinventing them.

## Skills

### Background (auto-applied)

These load automatically when you work on Cossack files. You don't invoke them.

| Skill | What it does |
|---|---|
| [`cossack-best-practices`](./cossack-best-practices/SKILL.md) | Directive guardrails: use framework built-ins instead of rolling your own. Ships deep-dive references for reactive `server$` resources, server/client RPC, directives, decorators, tasks, validation, stores, UI, forms, loading, database, cache, realtime, auth, Deno Desktop, and errors. |

### Slash commands

Invoke explicitly for multi-step workflows.

| Command | What it generates |
|---|---|
| [`/setup-auth`](./setup-auth/SKILL.md) | Full auth setup: install `@cossackframework/auth`, types, `createAuth()` config, middleware wiring, login route, protected pages. |
| [`/create-desktop-app`](./create-desktop-app/SKILL.md) | Add a Deno Desktop side target without changing the web adapter; configure native shell menus, tray/Dock lifecycle, dialogs, notifications, icons, RPC, and packaging. |
| [`/setup-websocket`](./setup-websocket/SKILL.md) | Real-time setup: pick SSE or Durable Object transport, wire channels/scope, configure the DO binding. |
| [`/setup-ui`](./setup-ui/SKILL.md) | UI package setup: `cossack add ui`, theme selection, component usage with `component()`, ejecting components, focus helpers, the global Toaster. |

For everything else (creating pages, layouts, components, adding state or middleware), just ask in plain language — the background skill gives the assistant everything it needs.

## Installation

### Via skills.sh

```bash
npx skills add https://github.com/cossackframework/skills
```

After installing, restart your tool (or run `/reload-plugins` in Claude Code).

## Usage

```
> add an email field with validation to the login form
# background skill kicks in → assistant uses @Validate(), not a custom validator

> /setup-auth
# interactive workflow scaffolds auth across types, auth.ts, index.ts, pages, guards

> set up a live counter that syncs across tabs
# /setup-websocket walks through SSE vs DO and wires the transport

> /setup-ui
# wires @cossackframework/ui: theme, CSS imports, component usage, Toaster

> /create-desktop-app
# adds a Desktop target beside the web runtime, with native shell capabilities, local RPC, icons, and packaging
```

## Compatibility

- [ZCode](https://zcode.z.ai/)
- [Claude Code](https://claude.com/claude-code) — Anthropic's CLI
- [Open Code](https://github.com/opencode-ai/opencode)
- Any tool that supports the Agent Skills convention (`.claude-plugin/plugin.json` + `SKILL.md`)

## Repository

This directory is auto-synced from [`cossackframework/cossack`](https://github.com/cossackframework/cossack) on every change to `skills/`. For the full framework documentation, see [cossack.dev](https://cossack.dev) and the [`docs/` directory](https://github.com/cossackframework/cossack/tree/master/docs) in the monorepo.
