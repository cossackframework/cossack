# Link

Unlike Next.js or similar traditional frameworks. In Cossack, there is no need any kind of `<Link>` component. We prefers browser behavior so just use the `<a>` tag normally. We did all prefetching, optimizing automatically for you out of the box.

The reason why this documentation exists because to help other framework's developers find the equivalent approach.

## How our prefetching and optimizing works?

- People hover/click on the `<a>` tag.
- Cossack only load the small piece of related page script, states and inject to current page.
- Cossack replaces the current URL in the history stack.
- People got the page load instantly!
