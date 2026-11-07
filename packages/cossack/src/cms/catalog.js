/**
 * What `cossack cms` can do: nouns, verbs, their arguments and options, and the management API
 * request each makes. Help, validation and the runner read this one table. `--url` and `--site`
 * go with every command.
 */

const COMMON = ['url', 'site'];
const PAGED = ['q', 'page', 'per-page'];
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const bool = (description, extra = {}) => ({ type: 'boolean', description, repeated: 'last', ...extra });

/** Every option a `cms` command may take; each command names the ones it accepts. */
export const CMS_FLAGS = {
  url: str('The CMS address, such as https://example.com (default: COSSACK_CMS_URL, the project\'s APP_URL, or the current login).'),
  site: str('A site of the network, by ID; main for the main site (default: COSSACK_CMS_SITE, or the login\'s site).'),
  email: str('The account\'s email (login; default: CMS_EMAIL, or a prompt).'),
  code: str('The second-factor code from an authenticator app (login).'),
  token: str('Store an existing application password instead of signing in (login).'),
  name: str('A name: the application password\'s (login), the MCP server\'s (mcp), a term\'s, a user\'s or a menu\'s.'),
  scope: str('What the application password may do (login; default: write).', { choices: ['read', 'write'] }),
  status: str('A status: entries (draft, pending, scheduled, published, trash, any), notes (open, resolved), users (active, disabled), sites (active, archived, deleted).'),
  q: str('Search words.'),
  page: str('Page number, from 1.'),
  'per-page': str('Items per page.'),
  locale: str('A language code, on a site with several languages.'),
  term: str('Entries of a term: taxonomy:slug, such as categories:news.'),
  filter: str('Entries matching a field: field=value; repeat for several.', { repeated: true }),
  format: str('Output: html renders rich text beside the JSON (entries); mcp prints json (a config block) or claude (a command).', { choices: ['json', 'html', 'claude'] }),
  data: str('A JSON object of fields, or @file, or @- for stdin.'),
  set: str('One field as name=value; JSON values are parsed (true, 3, ["a"]), others are text. Repeat for several; a.b nests.', { repeated: true }),
  rev: str('The revision you read; left out, the current one is read first.'),
  location: str('A theme menu location the menu shows in, such as primary; repeat for several (menus: the complete list).', { repeated: true }),
  at: str('When to publish, ISO 8601 (UTC); a future time schedules.'),
  body: str('A note\'s text.'),
  target: str('What a note anchors to: entry, field:<name>, block:<field>:<blockId> or text:<field>:<blockId>.text.'),
  quote: str('The passage a text note quotes.'),
  'reply-to': str('The thread\'s root note ID, for a reply.'),
  password: str('A password (users create, users update).'),
  role: str('A role ID, such as editor; repeat for several (users: the complete list).', { repeated: true }),
  kind: str('Media kind: image, video, audio, document or archive.', { choices: ['image', 'video', 'audio', 'document', 'archive'] }),
  host: str('A site\'s address, such as blog.example.com (sites create).'),
  admin: str('The first administrator\'s email, a network account (sites create).'),
  language: str('A language code, such as en (sites create).'),
  id: str('An ID to give a new site (sites create).'),
  limit: str('How many items.'),
  out: str('Write the result to this file instead of stdout.'),
  slug: str('A term\'s slug.'),
  parent: str('A term\'s parent ID; empty for the top level.'),
  description: str('A term\'s description.'),
  'no-starter': bool('Add no starter content to a new site (sites create).'),
  tag: str('A cache tag to purge, such as cms:main:c:posts; repeat for several (cache purge).', { repeated: true }),
  path: str('A page to purge, by URL; repeat for several (cache purge).', { repeated: true }),
  yes: bool('Confirm a delete.', { aliases: ['y'] }),
};

const WRITE = Object.freeze({ write: true });

/**
 * Each command: `noun`, `verb` (null for `login`, `logout`, `whoami`, `mcp`), `positionals`
 * (names; a trailing `...` takes the rest), `flags` it accepts beyond --url and --site, and for
 * API commands `request(args, flags, body)` returning `{ method, path, query, body, rev }`
 * (`rev: true` reads the entry's current revision first when --rev is absent), `destructive`
 * (needs --yes), `body: true` (takes --data and --set), and `table` for human output.
 */
export const CMS_COMMANDS = [
  { noun: 'login', verb: null, summary: 'Sign in and store an application password for this address (and site).', positionals: [], flags: ['email', 'code', 'token', 'name', 'scope'] },
  { noun: 'logout', verb: null, summary: 'Revoke the stored application password and forget the login.', positionals: [], flags: [] },
  { noun: 'whoami', verb: null, summary: 'Who the stored password acts as, on which site.', positionals: [], flags: [] },
  { noun: 'mcp', verb: null, summary: 'Print the MCP client configuration for this site: its URL and the stored password.', positionals: [], flags: ['format', 'name'] },

  { noun: 'collections', verb: 'list', summary: 'The content types and their fields.', positionals: [], flags: [],
    request: () => ({ method: 'GET', path: '/api/cms/collections' }), table: { rows: data => data.items, columns: ['name', 'label', 'publishable', { name: 'fields', value: row => row.fields.map(field => field.name).join(' ') }] } },
  { noun: 'collections', verb: 'schema', summary: 'The JSON Schema of a collection\'s entries.', positionals: ['collection'], flags: [],
    request: ([collection]) => ({ method: 'GET', path: `/api/cms/schema/${collection}` }) },

  { noun: 'taxonomies', verb: 'list', summary: 'The taxonomies, such as categories and tags.', positionals: [], flags: [],
    request: () => ({ method: 'GET', path: '/api/cms/taxonomies' }), table: { rows: data => data.items, columns: ['name', 'label', 'hierarchical'] } },

  { noun: 'terms', verb: 'list', summary: 'A taxonomy\'s terms.', positionals: ['taxonomy'], flags: PAGED,
    request: ([taxonomy], flags) => ({ method: 'GET', path: `/api/cms/terms/${taxonomy}`, query: paged(flags) }), table: { rows: data => data.items, columns: ['id', 'name', 'slug', 'parent'], total: true } },
  { noun: 'terms', verb: 'get', summary: 'One term.', positionals: ['taxonomy', 'id'], flags: [],
    request: ([taxonomy, id]) => ({ method: 'GET', path: `/api/cms/terms/${taxonomy}/${id}` }) },
  { noun: 'terms', verb: 'create', summary: 'Create a term.', positionals: ['taxonomy'], flags: ['name', 'slug', 'parent', 'description', 'data', 'set'], ...WRITE,
    request: ([taxonomy], flags, body) => ({ method: 'POST', path: `/api/cms/terms/${taxonomy}`, body: { ...body, ...picked(flags, ['name', 'slug', 'parent', 'description']) } }) },
  { noun: 'terms', verb: 'update', summary: 'Rename or move a term.', positionals: ['taxonomy', 'id'], flags: ['name', 'slug', 'parent', 'description', 'data', 'set'], ...WRITE,
    request: ([taxonomy, id], flags, body) => ({ method: 'PATCH', path: `/api/cms/terms/${taxonomy}/${id}`, body: { ...body, ...picked(flags, ['name', 'slug', 'parent', 'description']) } }) },
  { noun: 'terms', verb: 'delete', summary: 'Delete a term; entries keep their other terms.', positionals: ['taxonomy', 'id'], flags: ['yes'], destructive: true,
    request: ([taxonomy, id]) => ({ method: 'DELETE', path: `/api/cms/terms/${taxonomy}/${id}` }) },

  { noun: 'entries', verb: 'list', summary: 'Entries of a collection; --status any lists drafts and the rest.', positionals: ['collection'], flags: ['status', ...PAGED, 'locale', 'term', 'filter', 'format'],
    request: ([collection], flags) => ({ method: 'GET', path: `/api/cms/content/${collection}`, query: { ...paged(flags), status: flags.status, locale: flags.locale, term: flags.term, format: flags.format === 'html' ? 'html' : undefined, ...filters(flags.filter) } }),
    table: { rows: data => data.items, columns: ['id', 'status', 'title', 'slug', { name: 'updated', value: row => when(row.updatedAt) }], total: true } },
  { noun: 'entries', verb: 'get', summary: 'One entry by ID, or a published entry by slug, with its rev.', positionals: ['collection', 'id'], flags: ['format'],
    request: ([collection, id], flags) => ({ method: 'GET', path: `/api/cms/content/${collection}/${id}`, query: { format: flags.format === 'html' ? 'html' : undefined } }) },
  { noun: 'entries', verb: 'create', summary: 'Create an entry from --data or --set fields (status draft unless set).', positionals: ['collection'], flags: ['data', 'set'], ...WRITE,
    request: ([collection], _flags, body) => ({ method: 'POST', path: `/api/cms/content/${collection}`, body }) },
  { noun: 'entries', verb: 'update', summary: 'Change an entry\'s fields.', positionals: ['collection', 'id'], flags: ['data', 'set', 'rev'], ...WRITE,
    request: ([collection, id], flags, body) => ({ method: 'PATCH', path: `/api/cms/content/${collection}/${id}`, body, rev: revision(flags, `/api/cms/content/${collection}/${id}`) }) },
  { noun: 'entries', verb: 'delete', summary: 'Delete an entry permanently (trash keeps it recoverable).', positionals: ['collection', 'id'], flags: ['rev', 'yes'], destructive: true,
    request: ([collection, id], flags) => ({ method: 'DELETE', path: `/api/cms/content/${collection}/${id}`, rev: revision(flags, `/api/cms/content/${collection}/${id}`, 'query') }) },
  { noun: 'entries', verb: 'publish', summary: 'Publish an entry now, or schedule it with --at.', positionals: ['collection', 'id'], flags: ['at', 'rev'],
    request: ([collection, id], flags) => ({ method: 'POST', path: `/api/cms/content/${collection}/${id}/publish`, body: { ...(flags.at ? { at: flags.at } : {}), ...(flags.rev ? { rev: Number(flags.rev) } : {}) } }) },
  { noun: 'entries', verb: 'unpublish', summary: 'Take an entry off the site, back to a draft.', positionals: ['collection', 'id'], flags: ['rev'],
    request: ([collection, id], flags) => ({ method: 'POST', path: `/api/cms/content/${collection}/${id}/unpublish`, body: flags.rev ? { rev: Number(flags.rev) } : {} }) },
  { noun: 'entries', verb: 'trash', summary: 'Move an entry to the trash.', positionals: ['collection', 'id'], flags: ['rev'],
    request: ([collection, id], flags) => ({ method: 'PATCH', path: `/api/cms/content/${collection}/${id}`, body: { status: 'trash' }, rev: revision(flags, `/api/cms/content/${collection}/${id}`) }) },
  { noun: 'entries', verb: 'revisions', summary: 'An entry\'s revisions, newest first.', positionals: ['collection', 'id'], flags: ['limit'],
    request: ([collection, id], flags) => ({ method: 'GET', path: `/api/cms/content/${collection}/${id}/revisions`, query: { limit: flags.limit } }),
    table: { rows: data => data.items, columns: ['revision', { name: 'at', value: row => when(row.at) }, 'actor', 'status', 'title'] } },
  { noun: 'entries', verb: 'revision', summary: 'The content of one revision.', positionals: ['collection', 'id', 'revision'], flags: [],
    request: ([collection, id, revision]) => ({ method: 'GET', path: `/api/cms/content/${collection}/${id}/revisions/${revision}` }) },
  { noun: 'entries', verb: 'revert', summary: 'Restore a revision\'s fields as a new revision.', positionals: ['collection', 'id', 'revision'], flags: ['rev'],
    request: ([collection, id, revision], flags) => ({ method: 'POST', path: `/api/cms/content/${collection}/${id}/revisions/${revision}/restore`, body: flags.rev ? { rev: Number(flags.rev) } : {} }) },

  { noun: 'notes', verb: 'list', summary: 'An entry\'s review notes, or the entries with notes across the site.', positionals: ['collection?', 'id?'], flags: ['status', 'limit'],
    request: ([collection, id], flags) => collection && id
      ? { method: 'GET', path: `/api/cms/content/${collection}/${id}/notes`, query: { status: flags.status } }
      : { method: 'GET', path: '/api/cms/notes', query: { status: flags.status, limit: flags.limit } },
    table: { rows: data => data.threads ? data.threads.map(thread => ({ ...thread.root, replies: thread.replies.length })) : data.items.flatMap(item => item.threads.map(thread => ({ collection: item.collection, entry: item.entryId, ...thread.root, replies: thread.replies.length }))),
      columns: ['id', 'collection', 'entry', 'status', 'target', { name: 'body', value: row => String(row.body ?? '').slice(0, 60) }, 'replies'] } },
  { noun: 'notes', verb: 'add', summary: 'Leave a note on an entry, or reply with --reply-to.', positionals: ['collection', 'id'], flags: ['body', 'target', 'quote', 'reply-to'],
    request: ([collection, id], flags) => ({ method: 'POST', path: `/api/cms/content/${collection}/${id}/notes`, body: { body: flags.body ?? '', ...(flags['reply-to'] ? { parentId: flags['reply-to'] } : { target: flags.target ?? 'entry', ...(flags.quote ? { quote: flags.quote } : {}) }) } }) },
  { noun: 'notes', verb: 'resolve', summary: 'Resolve a thread by its root note.', positionals: ['noteId'], flags: [],
    request: ([noteId]) => ({ method: 'PATCH', path: `/api/cms/notes/${noteId}`, body: { status: 'resolved' } }) },
  { noun: 'notes', verb: 'reopen', summary: 'Reopen a resolved thread.', positionals: ['noteId'], flags: [],
    request: ([noteId]) => ({ method: 'PATCH', path: `/api/cms/notes/${noteId}`, body: { status: 'open' } }) },
  { noun: 'notes', verb: 'edit', summary: 'Change a note\'s text (its author).', positionals: ['noteId'], flags: ['body'],
    request: ([noteId], flags) => ({ method: 'PATCH', path: `/api/cms/notes/${noteId}`, body: { body: flags.body ?? '' } }) },
  { noun: 'notes', verb: 'delete', summary: 'Remove a note; a root takes its replies.', positionals: ['noteId'], flags: ['yes'], destructive: true,
    request: ([noteId]) => ({ method: 'DELETE', path: `/api/cms/notes/${noteId}` }) },

  { noun: 'users', verb: 'list', summary: 'The site\'s users and their roles.', positionals: [], flags: [...PAGED, 'role'],
    request: (_args, flags) => ({ method: 'GET', path: '/api/cms/users', query: { ...paged(flags), role: list(flags.role)[0] } }),
    table: { rows: data => data.items, columns: ['id', 'email', 'name', { name: 'roles', value: row => row.roles.map(role => role.id).join(' ') }, { name: 'last sign-in', value: row => when(row.lastSignedInAt) }], total: true } },
  { noun: 'users', verb: 'get', summary: 'One user, by ID or email.', positionals: ['id'], flags: [],
    request: ([id]) => ({ method: 'GET', path: `/api/cms/users/${id}` }) },
  { noun: 'users', verb: 'create', summary: 'Create a user with --email, --password, --name and --role.', positionals: [], flags: ['email', 'password', 'name', 'role', 'data', 'set'], ...WRITE,
    request: (_args, flags, body) => ({ method: 'POST', path: '/api/cms/users', body: { ...body, ...picked(flags, ['email', 'password', 'name']), ...(flags.role ? { roles: list(flags.role) } : {}) } }) },
  { noun: 'users', verb: 'update', summary: 'Change a user\'s name, email, password, roles or status.', positionals: ['id'], flags: ['email', 'password', 'name', 'role', 'status', 'data', 'set'], ...WRITE,
    request: ([id], flags, body) => ({ method: 'PATCH', path: `/api/cms/users/${id}`, body: { ...body, ...picked(flags, ['email', 'password', 'name', 'status']), ...(flags.role ? { roles: list(flags.role) } : {}) } }) },
  { noun: 'users', verb: 'delete', summary: 'Delete a user (on an added site, remove the member).', positionals: ['id'], flags: ['yes'], destructive: true,
    request: ([id]) => ({ method: 'DELETE', path: `/api/cms/users/${id}` }) },
  { noun: 'roles', verb: 'list', summary: 'The roles and their permissions.', positionals: [], flags: [],
    request: () => ({ method: 'GET', path: '/api/cms/roles' }), table: { rows: data => data.items, columns: ['id', 'name', 'users', { name: 'permissions', value: row => row.permissions.join(' ') }] } },

  { noun: 'settings', verb: 'get', summary: 'The settings document, or one group with its fields.', positionals: ['group?'], flags: [],
    request: ([group]) => ({ method: 'GET', path: group ? `/api/cms/settings/${group}` : '/api/cms/settings' }),
    table: { rows: data => data.values ? Object.entries(data.values).map(([field, value]) => ({ field, value: JSON.stringify(value), label: data.fields.find(entry => entry.name === field)?.label ?? '' })) : null, columns: ['field', 'value', 'label'] } },
  { noun: 'settings', verb: 'set', summary: 'Change fields of a group: --set siteTitle="My site".', positionals: ['group'], flags: ['data', 'set'], ...WRITE,
    request: ([group], _flags, body) => ({ method: 'PATCH', path: `/api/cms/settings/${group}`, body }),
    table: { rows: data => Object.entries(data.values).map(([field, value]) => ({ field, value: JSON.stringify(value) })), columns: ['field', 'value'] } },
  { noun: 'settings', verb: 'export', summary: 'The settings document as JSON, to stdout or --out.', positionals: [], flags: ['out'],
    request: () => ({ method: 'GET', path: '/api/cms/settings' }), raw: data => data.document },
  { noun: 'settings', verb: 'import', summary: 'Apply a settings document from --data @file.', positionals: [], flags: ['data'], ...WRITE,
    request: (_args, _flags, body) => ({ method: 'PUT', path: '/api/cms/settings', body }) },

  { noun: 'cache', verb: 'purge', summary: 'Purge the caches in front of the site: every page, or --tag and --path.', positionals: [], flags: ['tag', 'path'], ...WRITE,
    request: (_args, flags) => ({ method: 'POST', path: '/api/cms/cache/purge', body: { ...(flags.tag ? { tags: list(flags.tag) } : {}), ...(flags.path ? { urls: list(flags.path) } : {}) } }),
    table: { rows: data => data.results.map(result => ({ purger: result.purger, ok: result.ok ? 'yes' : 'no', tags: result.tags.join(' '), message: result.message })), columns: ['purger', 'ok', 'tags', 'message'] } },

  { noun: 'menus', verb: 'list', summary: 'The navigation menus and where they show.', positionals: [], flags: [],
    request: () => ({ method: 'GET', path: '/api/cms/appearance/menus' }), table: { rows: data => data.items, columns: ['id', 'name', 'items', { name: 'locations', value: row => row.locations.join(' ') }, { name: 'updated', value: row => when(row.updatedAt) }] } },
  { noun: 'menus', verb: 'get', summary: 'One menu: its items tree, rev and locations.', positionals: ['id'], flags: [],
    request: ([id]) => ({ method: 'GET', path: `/api/cms/appearance/menus/${id}` }) },
  { noun: 'menus', verb: 'create', summary: 'Create a menu from --data \'{"items":[…]}\' and show it with --location.', positionals: ['name'], flags: ['location', 'data', 'set'], ...WRITE,
    request: ([name], flags, body) => ({ method: 'POST', path: '/api/cms/appearance/menus', body: { ...body, name, ...(flags.location ? { locations: list(flags.location) } : {}) } }) },
  { noun: 'menus', verb: 'update', summary: 'Rename a menu (--name), replace its items (--data) or move it (--location).', positionals: ['id'], flags: ['name', 'location', 'data', 'set', 'rev'], ...WRITE,
    request: ([id], flags, body) => ({ method: 'PATCH', path: `/api/cms/appearance/menus/${id}`, body: { ...body, ...picked(flags, ['name']), ...(flags.location ? { locations: list(flags.location) } : {}) }, rev: revision(flags, `/api/cms/appearance/menus/${id}`) }) },
  { noun: 'menus', verb: 'delete', summary: 'Delete a menu; its locations show none.', positionals: ['id'], flags: ['yes'], destructive: true,
    request: ([id]) => ({ method: 'DELETE', path: `/api/cms/appearance/menus/${id}` }) },

  { noun: 'locations', verb: 'list', summary: 'The themes\' menu locations and the menu at each.', positionals: [], flags: [],
    request: () => ({ method: 'GET', path: '/api/cms/appearance/locations' }), table: { rows: data => data.items, columns: ['name', 'label', 'theme', 'active', 'menu'] } },
  { noun: 'locations', verb: 'set', summary: 'Show a menu at a location.', positionals: ['location', 'menu'], flags: [],
    request: ([location, menu]) => ({ method: 'PATCH', path: `/api/cms/appearance/locations/${location}`, body: { menu } }) },
  { noun: 'locations', verb: 'clear', summary: 'Show no menu at a location.', positionals: ['location'], flags: [],
    request: ([location]) => ({ method: 'PATCH', path: `/api/cms/appearance/locations/${location}`, body: { menu: null } }) },

  { noun: 'areas', verb: 'list', summary: 'The themes\' widget areas and the blocks each shows.', positionals: [], flags: [],
    request: () => ({ method: 'GET', path: '/api/cms/appearance/areas' }), table: { rows: data => data.items, columns: ['name', 'label', 'theme', 'active', 'rev', 'saved', { name: 'blocks', value: row => row.blocks.length }] } },
  { noun: 'areas', verb: 'get', summary: 'One widget area with its blocks and rev (0 while the theme\'s defaults show).', positionals: ['name'], flags: [],
    request: ([name]) => ({ method: 'GET', path: `/api/cms/appearance/areas/${name}` }) },
  { noun: 'areas', verb: 'set', summary: 'Replace an area\'s blocks from --data \'{"blocks":[…]}\'.', positionals: ['name'], flags: ['data', 'set', 'rev'], ...WRITE,
    request: ([name], flags, body) => ({ method: 'PUT', path: `/api/cms/appearance/areas/${name}`, body, rev: revision(flags, `/api/cms/appearance/areas/${name}`, 'body', 0) }) },
  { noun: 'areas', verb: 'reset', summary: 'Forget an area\'s saved blocks; the theme\'s defaults show again.', positionals: ['name'], flags: ['yes'], destructive: true,
    request: ([name]) => ({ method: 'DELETE', path: `/api/cms/appearance/areas/${name}` }) },

  { noun: 'media', verb: 'list', summary: 'Files in the media library.', positionals: [], flags: ['q', 'kind'],
    request: (_args, flags) => ({ method: 'GET', path: '/api/cms/media', query: { search: flags.q, kind: flags.kind } }), table: { rows: data => data.items, columns: ['id', 'name', 'kind', 'url'] } },
  { noun: 'media', verb: 'upload', summary: 'Upload files to the media library.', positionals: ['file...'], flags: [],
    request: files => ({ method: 'POST', path: '/api/cms/media', files }) },

  { noun: 'sites', verb: 'list', summary: 'The network\'s sites (network admins, on the network host).', positionals: [], flags: ['status', ...PAGED],
    request: (_args, flags) => ({ method: 'GET', path: '/api/cms/network/sites', query: { ...paged(flags), status: flags.status } }), table: { rows: data => data.items, columns: ['id', 'name', 'host', 'status'] } },
  { noun: 'sites', verb: 'get', summary: 'One site with its domains.', positionals: ['id'], flags: [],
    request: ([id]) => ({ method: 'GET', path: `/api/cms/network/sites/${id}` }) },
  { noun: 'sites', verb: 'create', summary: 'Add a site: a name and --host, with --admin, --language, --id and --no-starter.', positionals: ['name'], flags: ['host', 'admin', 'language', 'id', 'no-starter'],
    request: ([name], flags) => ({ method: 'POST', path: '/api/cms/network/sites', body: { name, ...picked(flags, ['host', 'admin', 'language', 'id']), ...(flags['no-starter'] ? { starter: false } : {}) } }) },
  { noun: 'sites', verb: 'archive', summary: 'Archive a site: visitors get 503, members keep the dashboard.', positionals: ['id'], flags: [],
    request: ([id]) => ({ method: 'PATCH', path: `/api/cms/network/sites/${id}`, body: { status: 'archived' } }) },
  { noun: 'sites', verb: 'restore', summary: 'Make an archived or deleted site active again.', positionals: ['id'], flags: [],
    request: ([id]) => ({ method: 'PATCH', path: `/api/cms/network/sites/${id}`, body: { status: 'active' } }) },
  { noun: 'sites', verb: 'delete', summary: 'Delete a site; it can be restored for 30 days.', positionals: ['id'], flags: ['yes'], destructive: true,
    request: ([id]) => ({ method: 'PATCH', path: `/api/cms/network/sites/${id}`, body: { status: 'deleted' } }) },
];

export const NOUNS = [...new Set(CMS_COMMANDS.map(command => command.noun))];

export function findCommand(noun, verb) {
  return CMS_COMMANDS.find(command => command.noun === noun && (command.verb === null || command.verb === verb));
}

export function verbsOf(noun) {
  return CMS_COMMANDS.filter(command => command.noun === noun && command.verb).map(command => command.verb);
}

/** The flags `cossack cms` accepts: every command's, plus --url and --site. */
export function cmsFlagDefinitions() {
  return Object.fromEntries([...COMMON, ...new Set(CMS_COMMANDS.flatMap(command => command.flags))].map(name => [name, CMS_FLAGS[name]]));
}

/** Shape diagnostics for the spec's `check`: the noun and verb exist, the arguments fit, and the options belong to the command. */
export function cmsDiagnostics(args, flags) {
  const [noun, verb, ...rest] = args;
  const error = (code, message) => [{ code, severity: 'error', message }];
  if (!NOUNS.includes(noun)) return error('COSSACK_ACTION_UNKNOWN', `Unknown cms command ${noun}. Available: ${NOUNS.join(', ')}.`);
  const command = findCommand(noun, verb);
  if (!command) {
    const verbs = verbsOf(noun);
    return error('COSSACK_ACTION_UNKNOWN', verb ? `Unknown cms ${noun} subcommand ${verb}. Available: ${verbs.join(', ')}.` : `cms ${noun} needs a subcommand: ${verbs.join(', ')}.`);
  }
  const given = command.verb === null ? [verb, ...rest].filter(value => value !== undefined) : rest;
  const required = command.positionals.filter(name => !name.endsWith('?') && !name.endsWith('...')).length;
  const variadic = command.positionals.some(name => name.endsWith('...'));
  const label = `cms ${noun}${command.verb ? ` ${command.verb}` : ''}`;
  if (given.length < required) return error('COSSACK_ARGUMENT_MISSING', `${label} takes ${describe(command.positionals)}.`);
  if (!variadic && given.length > command.positionals.length) return error('COSSACK_ARGUMENT_UNEXPECTED', `${label} takes ${describe(command.positionals) || 'no arguments'}.`);
  const accepted = new Set([...COMMON, ...command.flags, 'json', 'help', 'h']);
  const stray = Object.keys(flags).find(name => flags[name] !== undefined && !accepted.has(name));
  if (stray) return error('COSSACK_OPTION_UNSUPPORTED', `--${stray} is not an option of ${label}. Options: ${[...COMMON, ...command.flags].map(name => `--${name}`).join(', ')}.`);
  return [];
}

function describe(positionals) {
  return positionals.map(name => `<${name}>`).join(' ');
}

/** `name=value` pairs into a query, `filter[name]=value`. */
function filters(value) {
  return Object.fromEntries(list(value).map(pair => { const index = pair.indexOf('='); return index < 0 ? [`filter[${pair}]`, 'true'] : [`filter[${pair.slice(0, index)}]`, pair.slice(index + 1)]; }));
}

function paged(flags) {
  return { q: flags.q, page: flags.page, perPage: flags['per-page'] };
}

function picked(flags, names) {
  return Object.fromEntries(names.filter(name => flags[name] !== undefined).map(name => [name, Array.isArray(flags[name]) ? flags[name].at(-1) : flags[name]]));
}

export function list(value) {
  if (value === undefined || value === false) return [];
  return (Array.isArray(value) ? value : [value]).flatMap(item => String(item).split(',')).map(item => item.trim()).filter(Boolean);
}

/** `{ rev }` for a write: the given revision, or a read of the item first (`query` puts it in the URL; `min` 0 for widget areas, which start at revision 0). */
function revision(flags, read, where = 'body', min = 1) {
  return { given: flags.rev !== undefined ? Number(flags.rev) : undefined, read, where, min };
}

/** A time for a table. */
export function when(value) {
  if (value === null || value === undefined || value === '') return '';
  const date = new Date(typeof value === 'number' ? value : String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().replace('T', ' ').slice(0, 16);
}
