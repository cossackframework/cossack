# Remove <c:ComponentName> tag from the codebase

We previously introduced custom tags like `<c:Layout>` and `<c:Button>` to represent components in our templates. However, this is really hard to maintain and adds unnecessary complexity to our rendering logic. We should remove these tags and instead use a more straightforward approach to render components.

For example, instead of writing:

```html
<c:Button @click="${this.incrementNotifications}" ?disabled="${!!isNotificationLoading}">
    ${isNotificationLoading ? 'Updating Notifications...' : 'Increment Notifications'}
</c:Button>
```

We can simply write:

```js
${component(
    Button, 
    { '@click': this.incrementNotifications, disabled: !!isNotificationLoading }, 
    isNotificationLoading ? 'Updating Notifications...' : 'Increment Notifications'
)}
```

This will make our code cleaner and easier to understand, while also simplifying our rendering logic. 

To do so, we need to:
- Remove related logics that handle the parsing and rendering of `<c:ComponentName>` tags in our `packages/renderer`.
- Update all our existing components and pages to use the new `component()` function instead of the custom tags.
- Run existing tests to make sure everything still works as expected after the change.
