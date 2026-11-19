# Cossack reports

## 0.9.2 CMS on Workers: a burst of requests can leave a site's database client full for good ("Client request limit reached")

**Found in:** ACME, as a CMS project with one plugin (`~/Sites/acme`, branch `cms-plugin`), on the local Workers dev server with local `romedb serve` (2026-11-19). Not yet seen on a deployment: ACME is not deployed.

**What happened:** One RomeDB client serves every request to a site in an isolate, and allows 32 requests in flight (`@romedb/client` 0.2.24, `#active`). After dropped requests and a burst of requests to one site at once, the site answered 500 on every later request: `[cms] could not load collections ClientError: Client request limit reached` from `CmsHost.#loadDefinitions`, and the same on every read after it. It did not recover until the dev server restarted. Counting `fetch` calls of the database connection showed 32 that never settled, all started by `GET /dashboard/...` requests of that site.

**How to reproduce (in ACME):** `pnpm dev`, `pnpm seed`, then drop about 700 requests to a signed-in dashboard page of one site before their answer (delays of 5 to 300 ms), then send 20, 60 and 150 requests at once, then one request. Remove `fetch: requestFetch` and the `requestLifetime` middleware first (`src/cms.config.ts`, `src/bootstrap/middlewares.ts`); with them the site recovers. `scripts/abort-requests.ts` does the drops and the bursts.

**What I think happens (not proven in the runtime):** a database call gives its place back when its promise settles. A call whose request ends first never settles: the visitor left, or the request failed while other reads of the same `Promise.all` were in flight (`cmsMiddleware` reads three settings at once; `#loadDefinitions` reads at once too). Once the client refuses a call for lack of places, that request fails and strands more calls, so the fault feeds itself.

**Also:** with no dropped requests at all, 60 requests at once to one site gave some 500 answers (they recover). Each request makes several reads in flight at once, so about ten concurrent requests reach the limit of 32.

**Expected:** a site keeps serving after a burst. For example: the CMS passes the request's AbortSignal to its database calls, does not start reads at once that it could read in one statement, and replaces a client that reports `RDB_LIMIT` with outcome `not-sent`. The main site's client cannot be replaced from outside the CMS (`network.release()` refuses `main`).

**Workaround in ACME:** `src/request-fetch.ts`: the database connections of `storage` get a `fetch` that carries a signal of the current request; a first global middleware aborts it when the visitor leaves or the answer is 5xx, then probes the site's client with `SELECT 1` and calls `network.release(site.database)` when it answers `RDB_LIMIT` / `not-sent`. With it, a restaurant recovered every time in the test above. The main site is not covered.

**Status:** Fixed. A site keeps serving after dropped requests and a burst:

- On Workers, the CMS ends a request's database calls when its visitor leaves or the
  request fails (`cancelsRequestIo` in `cloudflareStorage`). Work after the answer (the
  outbox, maintenance) gets no signal.
- A cached read shared between requests is read again, once, when the request that started
  it ended (`settings.all()`, `network.resolve()`, `network.enabled()`, `host.ready()` and
  the host's activation state).
- The middleware reads the settings once, and collections and taxonomies are read in one
  request.
- If calls are stranded anyway, the binding opens a new client once the old one is full and
  holds calls long past their deadline, for added sites and the main site alike. A full
  client makes a burst wait and try again instead of failing.
- Found on the way: a failed site lookup served the main site at another site's address; it
  now answers 503. A failed read no longer turns the network off for 30 seconds, and a
  failed policy read no longer opens the network policy.

Docs: `packages/romedb/README.md` ("Requests that end early"), `docs/cms/index.md`. Tests:
`packages/romedb/tests/places.test.ts`, `packages/cms/tests/request-calls-unit.test.ts`.
ACME's `requestFetch`, the `requestLifetime` middleware and its client replacement can go.
