---
title: 'Your Own Pages in a CMS Project'
description: 'Add pages and API routes under src/pages in a CMS project, and read the CMS from them: the user, collections, settings and the database.'
---

# Your Own Pages in a CMS Project

A CMS project is a Cossack project. A file under `src/pages/` is a route, exactly as in
[Routing](/docs/routing.md): pages, layouts, loading states, API routes and Markdown pages.
A new CMS project has no `src/pages/` folder, because the CMS's own pages come from the
package. Create the folder when you need a page of your own.

Use a page of your own for a screen that is not content: a calculator, a checkout, a member
area, an endpoint for another service. For content that editors manage, use a collection.
For something you want to reuse in other projects, write a [plugin](/docs/cms/plugins.md).

## Where the file goes

| File | Address | Frame |
| --- | --- | --- |
| `src/pages/custom-route/index.ts` | `/custom-route` | None: the page renders alone. |
| `src/pages/(site)/custom-route/index.ts` | `/custom-route` | The active theme's header and footer. |
| `src/pages/dashboard/reports/index.ts` | `/dashboard/reports` | The dashboard, for signed-in users. |
| `src/pages/api/custom/titles.ts` | `/api/custom/titles` | An [API route](/docs/api-routes.md). |

- **Your page wins over an entry.** The CMS serves entries through a catch-all page, and a
  page file is more specific. The CMS also reserves the address: an entry that an editor
  names `custom-route` is saved as `custom-route-2`.
- **Only `/dashboard/*` asks for sign-in.** Every other address is public until you add a
  guard (see [Guards](#guards)).
- **A file at a CMS page's path replaces that page.** `src/pages/dashboard/index.ts`
  replaces the CMS's dashboard home, and the build prints the override. The replaced page
  stops receiving the package's fixes. See [Routing](/docs/routing.md).

## What the request holds

The CMS's middleware runs before every page, yours included. It puts these on the request,
typed, for `init()`, `@Server` methods and API handlers:

| Read | What it is |
| --- | --- |
| `this.c.get('cms')` | The CMS host of the site the request reached. Everything below comes from it. |
| `this.c.get('principal')` | Who is acting, for permission checks. A visitor is the anonymous principal. |
| `this.c.get('user')` | The signed-in user (`id`, `email`, `name`, `avatar`, `roles`), or `undefined`. |
| `this.c.get('site')` | The current site. With [multisite](/docs/cms/multisite.md), each site has its own database. |

In an API handler the request is the argument: `c.get('cms')`.

## A page

```ts
// src/pages/custom-route/index.ts
import { Cossack, Page, Server, State } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class CustomRoute extends Cossack {
  @State() site = '';
  @State() visitor = 'Guest';
  @State() titles: string[] = [];

  async init() {
    const cms = this.c.get('cms');
    this.site = String(await cms.settings.get('general.siteTitle'));
    this.visitor = this.c.get('user')?.name ?? 'Guest';
    const posts = await cms.resource('cms/posts').list({ limit: 10 }, { principal: this.c.get('principal') });
    this.titles = posts.records.map(record => String(record.title));
  }

  @Server()
  async count(): Promise<number> {
    return this.c.get('cms').resource('cms/posts').count({ where: { status: 'published' } }, { principal: this.c.get('principal') });
  }

  render() {
    return html`<main>
      <h1>Custom route on ${this.site}</h1>
      <p>Hello, ${this.visitor}</p>
      <ul>${this.titles.map(title => html`<li>${title}</li>`)}</ul>
    </main>`;
  }
}
```

A visitor who opens this page sees the published posts. An administrator sees the drafts
too, from the same code, because the repository answers for the principal you pass.

## Collections and entries

`cms.resource(id)` gives the repository of a collection. The built-in collections are
`cms/posts` and `cms/pages`; a collection defined in the dashboard is `cms/<name>`, and a
plugin's resource is `<plugin>/<name>`.

| Call | Result |
| --- | --- |
| `list({ where, order, limit, offset, after }, { principal })` | `{ records, next?, more? }`. `limit` is 1 to 100, default 20. |
| `get(id, { principal })` | The record, or `null`. |
| `count({ where }, { principal })` | The number of records the principal may read. |
| `create(input, { principal })` | The new record. |
| `update(id, patch, { principal, expectedRevision })` | The saved record. `expectedRevision` is the record's `revision` when you read it. |
| `delete(id, { principal, expectedRevision })` | Nothing. |

`where` compares declared fields: a value for equality, or `{ ne }`, `{ in }`, a range
(`{ gte, lt }`), `{ contains }`. Every call checks the principal's permissions and throws
when the principal may not do it.

`cms.collections()` lists the collection definitions.

## Settings, menus and the other services

| Read | For |
| --- | --- |
| `cms.settings.get('general.siteTitle')`, `cms.settings.all()` | [Settings](/docs/cms/settings.md), your plugins' groups included. |
| `cms.menus`, `cms.taxonomies`, `cms.areas` | Menus, terms, widget areas. |
| `cms.files` | Media. `null` when the project has no file storage. |
| `cms.siteSearch`, `cms.comments`, `cms.forms` | Search, comments, forms. |
| `cms.mail` | The mail sender, or `null` when none is configured. |
| `cms.db` | The site's RomeDB database, for statements of your own. |

`cms.db` does not check permissions and does not run hooks, revisions or the search
index. Use a repository for entries, and `cms.db` for tables of your own.

## Guards

`requireAny()` lets in holders of at least one permission. A visitor is sent to the
sign-in page, and a signed-in user without the permission is sent to the dashboard. A
server method or an upload answers 401 or 403 instead.

```ts
// src/pages/members/index.ts
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { PERMISSIONS } from '@cossackframework/cms';
import { requireAny } from '@cossackframework/cms/app/cms/guards';

@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.dashboard)] })
export default class Members extends Cossack {
  render() {
    return html`<h1>Members only: ${this.c.get('user')?.email}</h1>`;
  }
}
```

For a check of your own, read the user in `init()`, or test one permission with
`hasPermission(this.c.get('principal'), PERMISSIONS.manageSettings)` from
`@cossackframework/cms`.

## Sessions and accounts

The sign-in pages are the CMS's (`/auth/login`, `/auth/register`). A page of your own
that needs more imports the functions those pages use, from `@cossackframework/cms/app/auth`:
`logout(c)`, `listUserSessions(c)`, `revokeSession(c, reference)`, `updateUserProfile(id, patch)`.

## An API route

```ts
// src/pages/api/custom/titles.ts
import type { Context } from 'hono';

export async function GET(c: Context) {
  const posts = await c.get('cms').resource('cms/posts').list({ where: { status: 'published' }, limit: 10 }, { principal: c.get('principal') });
  return c.json({ titles: posts.records.map(record => record.title) });
}
```

The CMS's own content API is under `/api/cms/` ([Management API](/docs/cms/api.md)).
Choose another prefix for yours.

## What a page does not get

- **Theme helpers.** `helpers.menu`, `helpers.layout` and the template data are passed to a
  theme's templates. A page under `(site)` gets the theme's header and footer from the site
  layout, and nothing else from the theme.
- **Plugin capabilities.** `context.files`, `context.mail` and the granted permissions belong
  to a plugin's `server.ts`. A page of the project is trusted code: it reads the host.
- **Updates.** The file is yours. `cossack upgrade` does not change it.

The pages on this page are built and requested by
`packages/cossack/tests/generated-runtime-cms-project-pages.test.js`.
