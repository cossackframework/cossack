TODOs and Future Improvements

## Storage Integration

A lot of users struggle with uploading and managing files (yes, it's hard too)
It's easy to implement storage for Node.js because they have built in `fs` module, but Cloudflare Workers or other serverless, is lack of native file storage.

So, we can create a package that integrates with popular storage solutions like AWS S3, Google Cloud Storage, or Cloudflare R2 (preferred).

### Considerations
- Simple backend's SDK wrappers for file upload/download. Maybe an endpoint like we do with `crpc`.
- Client components for file selection and upload progress, supporting streaming large files with chunked uploads, we might create a `<FileUploader>` component.
- Unstyled components to allow users to style them as they wish, and allowing them to modify to fit their needs (e.g., drag-and-drop support).

## Node Adapter

Currently, in node adapter, we have to manually import all components to build the component registry. This can be improved in the future with automatic discovery or a better registry system.

```typescript
const app = createApp();
const componentRegistry = ...; // Map of ComponentName -> ComponentClass
```

We might consider either:
- Using vite glob imports to automatically gather components.
- Use node's fs module to read the filesystem and dynamically import components.

## Access bindings

Cloudflare Workers support various bindings (KV, Secrets, Env Variables, etc.) that are not yet directly accessible in Cossack components.
We should create a standardized way to access these bindings within Cossack components, possibly through dependency
For example, we can let user to call `this.env.KV_NAMESPACE.get('key')` inside a component method.

## Docs
React to Cossack guide
A guide for React developers to migrate their knowledge to Cossack framework.

## Directives

Implement custom directives similar to Lit.