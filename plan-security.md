# Plan - Security

Currently, we generated both client and server code the same in both client and server. However, by doing so, we are exposing server-only code to the client, which is a security risk.

## Proposed Solution

To mitigate this risk, I recommend writing a Vite plugin that will strip out all server-only code, or just keep the method name but remove the body from the client bundle during the build process. 

### Rules for the Plugin

- Secure by default: All methods are considered server by default, except our built-in methods.
- Client methods are marked with `@Client`, `@Optimistic`, `@Computed` decorator.
- Shared methods are marked with `@Shared` decorator (need to create new), or `render` method.

### Breaking Changes and Considerations

- `init` method previously was used for both client and server initialization. However, since we usually need to run database queries in `init`, it should be considered server-only. Therefore, we might need to drop support for `init` method in the client. I think nothing needed to be done here because the client is already use `window.__INITIAL_STATE__` for initialization already.
- Check our `docs` folder to make sure any issues we might have missed.