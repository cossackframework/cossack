# Plan - Fix Tasks Document and Skills

## Problems
Currently, the `./docs/tasks.md` document is missing two important lifecycle methods:
- `onMount()` and `onNavigateComplete()` does not have enough documentation, they deserve their own sections.
- Event Decorators like `@On`, `@OnWindow`, `@OnDocument` documented as Legacy, I think they are quite beautify, and maybe support some custom events like `@On('mount')` and `@On('navigate-complete')`. So `@On('mount') = onMount()` and `@On('navigate-complete') = onNavigateComplete()`.

## Plan
1. Add `onMount()` and `onNavigateComplete()` sections to `./docs/tasks.md` under the **Lifecycle Methods** section.
2. Keep `@On`, `@OnWindow`, `@OnDocument` as documented, check the code to make sure they actually still there, also add support for `@On('mount')` and `@On('navigate-complete')`. as shortcut of the equivalent lifecycle methods.
3. Not important but maybe add a few soft typehinting so when we type `@On(` or `@OnWindow(` or `@OnDocument(` it suggests the correct parameters. Maybe a few possible params for them. For example `resize` for `@OnWindow`. Not a must, but nice to have.
4. Write e2e and run existing tests carefully to ensure nothing's broken.