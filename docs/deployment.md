# Deployment

## Cloudflare Workers (Default)

Cossack applications deploy to Cloudflare Workers using Wrangler.

### Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up)
- Wrangler CLI installed (`npm install -g wrangler`)

### Configure

Your project includes a `wrangler.jsonc` with the required bindings:

```jsonc
{
  "name": "my-app",
  "main": "./src/index.ts",
  "durable_objects": {
    "bindings": [
      { "name": "COSSACK_OBJECT", "class_name": "AppDurableObject" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_classes": ["AppDurableObject"] }
  ]
}
```

If using pages with `transport: 'sse'`, no Durable Object binding is required — SSE runs on plain Workers.

### Deploy

```sh
npx wrangler deploy
```

### Environment Variables and Secrets

Set secrets via the Wrangler CLI (never commit them to `wrangler.jsonc`):

```sh
npx wrangler secret put DATABASE_URL
```

Non-sensitive variables can go in `wrangler.jsonc` under `"vars"`:

```jsonc
{
  "vars": {
    "PUBLIC_API_URL": "https://api.example.com"
  }
}
```

### Bindings

Cossack integrates with Cloudflare bindings. Access them in your components via `this.env`:

```typescript
@Server()
async getTasks() {
    const db = this.env.DB; // D1 binding
    const bucket = this.env.MY_BUCKET; // R2 binding
}
```

Add bindings to `wrangler.jsonc`:

```jsonc
{
  "d1_databases": [
    { "binding": "DB", "database_name": "my-db", "database_id": "xxx" }
  ],
  "r2_buckets": [
    { "binding": "MY_BUCKET", "bucket_name": "my-bucket" }
  ]
}
```

### Custom Domains

Add a custom domain to your Worker in the Cloudflare dashboard under **Workers & Pages > your Worker > Settings > Domains & Routes**, or via `wrangler.jsonc`:

```jsonc
{
  "routes": [
    { "pattern": "www.example.com/*", "custom_domain": true }
  ]
}
```

---

## Node.js

For Node.js deployments, see the [Adapters guide](./adapters.md).

```sh
# Build for production
pnpm build

# Start the server
node dist/server.js
```

State is memory-only in Node.js mode — use an external database for persistence.

---

## Static Site Generation (SSG)

For fully static pages, use the SSG feature to pre-render pages at build time. See [Static Site Generation](./static-site-generation.md).
