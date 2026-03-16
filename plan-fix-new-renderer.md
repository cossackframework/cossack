## Items
### Refs
The refs does not work at all. Check @docs/ref.md about our previous implementation and how refs should work. Our example component in @framework/src/pages/refs shows how refs should be used. Currently, the focus state is working but the animate box does not work. Please fix the refs implementation, add e2e tests for refs and update the documentation and example component if needed.

### Events
The event system is moved to use the same API as `Lit`. Our previous documentation is @docs/events.md but it is outdated. Our example component in @framework/src/pages/events is also outdated too. We should either:
- Update the documentation and example component to reflect the new event system.
- Add support for the old event system back.