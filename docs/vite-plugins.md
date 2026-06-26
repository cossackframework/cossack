---
title: "Vite Plugins"
description: "Custom Vite security plugin that strips server code from client bundles to prevent leaking sensitive logic and data."
---

# Vite Plugins

Beside of using the official Cloudflare Vite plugin, Cossack also ship with our security plugin. The plugin's job is to clear server's codes from the client bundle so all of your server code is not leaked. We called `vite-security-plugin`.