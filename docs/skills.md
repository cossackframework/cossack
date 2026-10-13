---
title: "Cossack Skills for Claude Code & Open Code"
description: "Instruction packs that teach AI coding assistants how to work with the Cossack Framework for common development tasks."
---

# Cossack Skills for Claude Code & Open Code

Cossack Skills are instruction packs that teach AI coding assistants (Claude Code, Open Code, and any Agent Skills-compatible tool) how to work with the Cossack Framework. They give step-by-step guidance for common tasks such as creating pages, adding state, and setting up auth.

## What is Included

| Skill | Type | Description |
|-------|------|-------------|
| `/setup-auth` | Task | Set up authentication with `@cossackframework/auth` (multi-file workflow) |
| `/setup-websocket` | Task | Set up real-time features: pick SSE or Durable Object transport |
| `/setup-ui` | Task | Set up the UI package (`@cossackframework/ui`): theme, CSS imports, component usage, focus helpers, Toaster |
| `/create-desktop-app` | Task | Add an Electron Desktop side target, secure native shell capabilities, icons, lifecycle, and Forge packaging without changing the web runtime |
| `cossack-best-practices` | Background | Guardrails for `@Server()` RPC, ORM entities, validation, caching, UI, tasks, stores, auth, and error handling. |

The `cossack-best-practices` skill is not user-invocable. It auto-loads when you work on Cossack-specific files (`src/pages/**`, `src/components/**`, `src/services/**`, `src/middlewares/**`, `src/App.ts`, `src/root.ts`) and steers the AI toward framework built-ins.

## Installation

### Option 1: Marketplace Install (Recommended)

Install from the dedicated plugin repository:

```bash
claude plugin install cossack-skills
```

The plugin repo ([cossackframework/skills](https://github.com/cossackframework/skills)) is auto-synced from the monorepo on every change to `skills/`.

### Option 2: Skills-Directory Plugin

Copy or symlink the `skills/` folder into `.claude/skills/` in your project. Claude Code auto-discovers any folder containing a `.claude-plugin/plugin.json` manifest and loads it as a plugin named `<name>@skills-dir`. No marketplace or install step is needed.

In a Cossack app project:

```bash
# Clone or copy the skills directory into your project
cp -r /path/to/cossack/skills .claude/skills/cossack

# Or symlink for development (stays in sync with the monorepo)
ln -s /path/to/cossack/skills .claude/skills/cossack
```

After this, the plugin loads as `cossack@skills-dir` on the next Claude Code session. All skills (`/setup-auth`, `/setup-websocket`, `/setup-ui`, and the `cossack-best-practices` background skill) are immediately available.

Global, for all projects:

```bash
cp -r /path/to/cossack/skills ~/.claude/skills/cossack
```

Global skills load in every project.

### Option 3: Per-Session with `--plugin-dir`

Use `--plugin-dir` to load the skills for a single session without any setup:

```bash
# From inside a Cossack project
claude --plugin-dir /path/to/cossack/skills

# Or from the monorepo itself
claude --plugin-dir ./skills
```

### Option 4: Manual (Individual Skills)

Copy individual skill folders to `.claude/skills/` in your project or globally:

```bash
# Per-project — copy only the skills you need
cp -r skills/cossack-best-practices .claude/skills/
cp -r skills/setup-auth .claude/skills/

# Global
cp -r skills/cossack-best-practices ~/.claude/skills/
cp -r skills/setup-auth ~/.claude/skills/
```

Individual skill folders (without a `.claude-plugin/plugin.json`) register as plain skills, not as a plugin. They still work, but they do not get the namespaced `cossack@skills-dir` identity.

## Usage

### Invoking Skills

Use the slash command syntax in your AI tool:

```
/setup-auth
/setup-websocket
/setup-ui
```

The skill guides the AI through the correct patterns and asks questions when it needs more information. For all other tasks, such as creating pages, layouts, components, adding state, and middleware, the `cossack-best-practices` background skill gives the AI the framework rules. Ask in plain language.

### Auto-Loading Best Practices

The `cossack-best-practices` skill activates automatically when you open or edit Cossack files. You do not need to invoke it. It gives the AI a list of framework built-ins (decorators, validation, loading, images, refs, routing conventions). The AI then uses them instead of writing its own.

Example: open `src/pages/about/index.ts` and ask for an email field with validation. The AI then uses `@Validate()` instead of writing a custom validator.

## Compatible Tools

- [Claude Code](https://claude.com/claude-code): Anthropic's CLI tool
- [Open Code](https://github.com/opencode-ai/opencode): Open-source AI coding agent
- Any tool that supports Agent Skills (`.claude-plugin/plugin.json` + `SKILL.md` convention)

## Troubleshooting

### Skills Not Showing

1. Make sure that the skill directory contains a `SKILL.md` file
2. Make sure that the skill folder is in the right location (`.claude/skills/` or registered as a plugin)
3. Restart your AI tool after installing new skills

### Plugin Not Loading

1. Make sure that `.claude/skills/cossack/.claude-plugin/plugin.json` exists
2. Run `claude plugin list`. The plugin must appear as `cossack@skills-dir`.
3. If it does not appear, run `/reload-plugins` inside Claude Code or restart the session
4. Make sure that you launched Claude Code from the project root. Project-scope plugins only scan `<cwd>/.claude/skills/`.

### Skills Out of Date

If you symlinked the skills directory, pull the latest changes. Skills auto-refresh. If you copied the files, copy them again from the monorepo:

```bash
rm -rf .claude/skills/cossack
cp -r /path/to/cossack/skills .claude/skills/cossack
```
