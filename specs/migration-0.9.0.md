# Draft 0.9.0 migration guide

This is a working record of verified behavior changes. It is not yet a complete
release migration guide. REL-04 must audit the full release checklist, add every
remaining break, compile its examples, and verify package installation before
publishing 0.9.0. Package versions remain 0.8.3 while that work is open.

## Ordinary RPC results no longer appear as generator yields

Ordinary HTTP/SSE component calls previously yielded their JSON return value
once. WebSocket and explicit service calls returned it only at completion.
All transports now keep ordinary results in completion, matching
`RpcCall<Result, never>`. Async generator actions still yield their incremental
values and return their final result separately.

Replace a loop that consumes an ordinary method's single result:

```typescript
// Before: depended on HTTP/SSE's extra yield.
for await (const result of this.save(input)) {
  this.savedId = result.id;
}

// After: completion works across transports.
const result = await this.save(input);
this.savedId = result.id;
```

If the action is a generator, keep one call and iterate then await it:

```typescript
const call = rpc$(this.generate(3));
for await (const progress of call) {
  this.progress = progress.step;
}
const result = await call;
this.total = result.total;
```

Import `rpc$` from `@cossackframework/core` and use it in a client handler.
The helper infers the authored generator's yield and terminal types; it returns
the existing proxy operation by identity. It is not a wrapper for native server
execution. See [the complete client contract](../docs/rpc.md) for cancellation,
duplicate consumers, broad iterable annotations, and native Response types.
