---
title: "Installation & Setup"
description: "Get started with Cossack framework using the create-cossack-app CLI tool with support for Node.js v22 and modern editors."
---

# Installation & Setup

Cossack is a new kind of framework that is borderless, build for the edge and minimal syntax.

## Prerequisites

To get started with Cossack locally, you need:

- Node.js v22+
- An editor (VS Code preferred)

## Creating a New Project

The easiest way to start a new Cossack project is by using the `create-cossack-app` CLI tool.

### Usage

Run the following command in your terminal:

```sh
npx create-cossack-app@latest my-app
```

Replace `my-app` with your desired project name.

### Adapter Selection

During the setup process, you will be prompted to choose a server adapter:

1.  **Cloudflare Workers (Default):** Best for edge deployments, automatic state persistence, and scalability. Requires a Cloudflare account.
2.  **Node.js:** Best for traditional server deployments (Docker, VPS) or local development without Cloudflare dependencies. Note that component state is memory-only in this mode.

The CLI will automatically configure your `package.json`, `tsconfig.json`, and entry points based on your selection.