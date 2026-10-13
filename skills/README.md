# Cossack Skills

Agent Skills for working with the [Cossack Framework](https://github.com/cossackframework/cossack). In the framework, a single component class runs on both server and client.

These skills teach AI coding assistants the conventions and built-in features of the framework. Claude Code, Open Code, and any Agent Skills-compatible tool can load them. The assistant then uses `@Validate`, `Image()`, `this.loading`, and `@Ref()` instead of writing custom replacements.

## Skills

### Background (auto-applied)

These load automatically when you work on Cossack files. You do not invoke them.

| Skill | What it does |
|---|---|
| [`cossack-best-practices`](./cossack-best-practices/SKILL.md) | Guardrails that direct the assistant to framework built-in features instead of custom code. It includes references for reactive `server$` resources, server/client RPC, directives, decorators, tasks, validation, stores, UI, forms, loading, database, cache, realtime, auth, Electron Desktop, and errors. |

### Slash commands

Invoke explicitly for multi-step workflows.

| Command | What it generates |
|---|---|
| [`/setup-auth`](./setup-auth/SKILL.md) | Full auth setup: install `@cossackframework/auth`, types, `createAuth()` configuration, middleware wiring, a login route, and protected pages. |
| [`/create-desktop-app`](./create-desktop-app/SKILL.md) | Add an Electron Desktop side target without changing the web adapter. Configure secure local RPC, native shell lifecycle, icons, and Forge packaging. |
| [`/setup-websocket`](./setup-websocket/SKILL.md) | Real-time setup: pick SSE or Durable Object transport, wire channels/scope, configure the DO binding. |
| [`/setup-ui`](./setup-ui/SKILL.md) | UI package setup: `cossack add ui`, theme selection, component usage with `component()`, ejecting components, focus helpers, the global Toaster. |

For other work, such as creating pages, layouts, components, state, or middleware, ask in plain language. The background skill gives the assistant the framework conventions.

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
- [Claude Code](https://claude.com/claude-code), the CLI from Anthropic
- [Open Code](https://github.com/opencode-ai/opencode)
- Any tool that supports the Agent Skills convention (`.claude-plugin/plugin.json` + `SKILL.md`)

## Repository

This directory is auto-synced from [`cossackframework/cossack`](https://github.com/cossackframework/cossack) on every change to `skills/`. For the full framework documentation, see [cossack.dev](https://cossack.dev) and the [`docs/` directory](https://github.com/cossackframework/cossack/tree/master/docs) in the monorepo.
