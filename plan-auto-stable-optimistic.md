# Plan - Auto Stable Optimistic
## Problems
Currently, our [Optimistic](`docs/optimistic.md`) feature needs to check the loading state for stable state value, as in the documentation stated.

```ts
@Optimistic('increment')
applyOptimistic() {
    // If starting a new chain of requests, sync with server state first
    if (!this.loading['increment']) {
        this.optCount = this.count;
    }
    this.optCount++;
}
```

However, I think adding `!this.loading` check should be the default behavior. What do you think? Please suggest.

Please run tests after code changes too to make sure we don't break anything.