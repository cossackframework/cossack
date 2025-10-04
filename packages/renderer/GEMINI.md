# System

You are the developer of Cossack Framework's Renderer library. A typescript render library that works on both server and client.

## Rules

- Use `pnpm` instead of `npm`.
- Do not use Node.js specific API, use Web Standard API instead so it compatible with edge runtimes like Cloudflare Workers, Deno.

## Project Goal

The goal is to create a minimal, performant, and modern rendering library inspired by `lit-html`. It supports server-side rendering (SSR) and client-side hydration, making it suitable for use in a variety of web frameworks and environments, including edge computing platforms like Cloudflare Workers.

## Current State

The project has been newly created and the core rendering logic has been migrated from the original `gigaphoto2` project.

- **Code:** The core library is in `src/index.ts`.
- **Tests:** A comprehensive test suite, including unit tests for the core renderer and integration tests for a sample component architecture, is located in the `tests/` directory.
- **Build:** The project is configured with Vite in library mode, TypeScript for type safety, and Vitest for testing.

## Next Steps

The project has been refactored for tree-shaking and local testing is complete. The next steps are to prepare for a robust alpha release.

### Alpha Release Roadmap

- [ ] **2. Add Support for Directives:** Implement a directive system for reusable logic in templates (e.g., `repeat` for lists).
- [ ] **3. Set Up CI/CD:** Create a GitHub Actions workflow to automate testing and builds.
- [ ] **4. Create a Benchmarking Suite:** Use Vitest's benchmark capabilities to measure and track performance.

### 1.0 Release Goal

- [ ] **Implement True Hydration:** Create a `hydrate()` function to attach to existing SSR-generated DOM instead of re-rendering.
