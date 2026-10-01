---
title: "Installation & Setup"
description: "Create a Cossack project with the Cossack CLI."
---

# Installation & Setup

Cossack is a framework for building applications that run on the edge or on Node.js.

## Prerequisites

To use Cossack locally, install:

- Node.js v22+
- An editor (VS Code preferred)

## Creating a New Project

Use the `cossack` CLI tool to create a project.

### Usage

Run this command in a terminal:

```sh
npx cossack create my-app
```

Replace `my-app` with your project name.

### Adapter Selection

During setup, choose a server adapter:

1. **Cloudflare Workers (Default):** Use this adapter to deploy to Cloudflare's edge network. It requires a Cloudflare account.
2. **Node.js:** Use this adapter to run the app on a Node.js server or locally without Cloudflare. Component state stays in memory.

The CLI configures `package.json`, `tsconfig.json`, and the entry points for the adapter you choose.
