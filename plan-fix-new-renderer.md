## Items
### Refs
The refs does not work at all. Check @docs/ref.md about our previous implementation and how refs should work. Our example component in @framework/src/pages/refs shows how refs should be used.

### Loading State
The loading state only work on client redirect, not on server render. We need to fix that. Check our @docs/loading.md and example component in @framework/src/pages/lifecycle

### Events
The event system is moved to use the same API as `Lit`. Our previous documentation is @docs/events.md but it is outdated. Our example component in @framework/src/pages/events is also outdated too. We should either:
- Update the documentation and example component to reflect the new event system.
- Add support for the old event system back.