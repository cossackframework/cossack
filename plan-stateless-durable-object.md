# Plan - Stateless Durable Object

Currently, when we use `transport: 'durable-object'`, all states are stored on Cloudflare Durable Objects and persist there forever.
However, this behavior seems unexpected for most developers, we better use Durable Object as WebSocket hub that don't store anything because the data should be stored on database by users for easier to control, familiar experience.

So, we should change Durable Object to stateless from stateful, developers that want stateful can define `stateful: true` to keep the current behavior.

So, to define websockets transport via Cloudflare Workers:

```ts
@Page({
    transport: 'durable-object'
})
```

This will make stateless page that most developers expected. To make it stateful, they either persist on DB themselves (most of developer will), or automatically like so:

```ts
@Page({
    transport: 'durable-object',
    stateful: true
})
```

## Notices

This is a breaking change, high impact, so after updating code, please:

- Update related docs on the `docs` folder.
- Update all unit tests and e2e tests related to `durable-object`.
- Update related skills in the `skills` folder.
- Run tests again carefully!