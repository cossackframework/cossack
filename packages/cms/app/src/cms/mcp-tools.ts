/**
 * The MCP tools of a site: one per management operation, over the same functions the REST
 * routes and `cossack cms` use. A tool's input schema is what the client shows its model; the
 * operation checks the values and the principal's permissions.
 */
import type { Context } from 'hono';
import { CmsError, isCmsError } from '@cossackframework/cms';
import { ClientVisibleError } from '@cossackframework/core';
import type { JsonSchema, JsonSchemaProperty, McpTool } from './mcp';
import * as manage from './manage';

export interface ToolContext { readonly c: Context }

type Tool = McpTool<ToolContext>;
type Input = { readonly [name: string]: unknown };

const str = (description: string, extra: Partial<JsonSchemaProperty> = {}): JsonSchemaProperty => ({ type: 'string', description, ...extra });
const int = (description: string, extra: Partial<JsonSchemaProperty> = {}): JsonSchemaProperty => ({ type: 'integer', description, ...extra });
const bool = (description: string): JsonSchemaProperty => ({ type: 'boolean', description });
const obj = (description: string): JsonSchemaProperty => ({ type: 'object', description, additionalProperties: true });
const schema = (properties: { [name: string]: JsonSchemaProperty }, required: string[] = []): JsonSchema => ({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false });
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const CHANGE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const DESTROY = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;

const collection = str('The collection, such as posts or pages (see list_collections).');
const id = str('The entry ID.');
const rev = int('The revision you read, so a change made meanwhile is not overwritten (409). Left out, the current revision.');
const page = int('Page number, from 1.', { minimum: 1 });
const perPage = int('Entries per page, 1 to 100.', { minimum: 1, maximum: 100 });

/** Query strings for an operation that reads request parameters. */
function query(input: Input, names: readonly string[]): { [key: string]: string } {
    const out: { [key: string]: string } = {};
    for (const name of names) if (input[name] !== undefined && input[name] !== null) out[name] = String(input[name]);
    return out;
}

function string(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function fields(value: unknown): manage.Body {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as manage.Body : {};
}

export const cmsTools: readonly Tool[] = [
    {
        name: 'get_site', title: 'This site and who you are',
        description: 'Start here: the site, who the application password acts as (roles, permissions), the content types and taxonomies, and whether the network is on.',
        inputSchema: schema({}), annotations: READ,
        async run(_input, { c }) {
            const [who, collections, taxonomies] = await Promise.all([manage.whoami(c), manage.collectionsList(c), manage.taxonomiesList(c)]);
            return { ...who, collections: collections.items.map(entry => ({ name: entry.name, label: entry.label, publishable: entry.publishable, taxonomies: entry.taxonomies })), taxonomies: taxonomies.items.map(entry => ({ name: entry.name, label: entry.label, hierarchical: entry.hierarchical })) };
        },
    },
    {
        name: 'list_collections', description: 'The content types with their fields (name, kind, required, enum values). Entries are created and changed with these field names.',
        inputSchema: schema({}), annotations: READ,
        async run(_input, { c }) { return manage.collectionsList(c); },
    },
    {
        name: 'get_collection_schema', description: 'The JSON Schema of a collection\'s entries, for building a valid create_entry or update_entry call. Rich text is a ProseMirror document; blocks are { _id, type, data }.',
        inputSchema: schema({ collection }, ['collection']), annotations: READ,
        async run(input, { c }) { return manage.collectionSchema(c, string(input.collection)); },
    },
    {
        name: 'list_entries', description: 'Entries of a collection, a page at a time. Without status, published entries newest first; status "any" or draft, pending, scheduled, published, trash lists others (most recently changed first). q searches; term "categories:news" filters by a term; filter matches fields by value.',
        inputSchema: schema({
            collection, status: str('One of draft, pending, scheduled, published, trash, or any. Default: published.'), q: str('Search words.'), page, perPage,
            locale: str('A language code, on a site with several languages.'), term: str('taxonomy:slug, such as categories:news.'),
            filter: { type: 'object', description: 'Field values to match, such as { "featured": true }.', additionalProperties: true },
        }, ['collection']), annotations: READ,
        async run(input, { c }) {
            const parameters = query(input, ['status', 'q', 'page', 'perPage', 'locale', 'term']);
            for (const [name, value] of Object.entries(fields(input.filter))) parameters[`filter[${name}]`] = String(value);
            return manage.entriesList(c, string(input.collection), parameters);
        },
    },
    {
        name: 'get_entry', description: 'One entry by ID, or a published entry by slug: every field, its rev (needed to change it), URL, the synced patterns it uses and its translations. html: true adds rendered rich text and blocks.',
        inputSchema: schema({ collection, id: str('The entry ID, or the slug of a published entry.'), html: bool('Also render rich text and blocks to HTML.') }, ['collection', 'id']), annotations: READ,
        async run(input, { c }) {
            const view = await manage.entryRead(c, string(input.collection), string(input.id), { html: input.html === true });
            if (!view) throw new CmsError('CMS_NOT_FOUND', 'Entry not found.');
            return view;
        },
    },
    {
        name: 'create_entry', description: 'Create an entry from its fields (see list_collections): title, status (draft by default; published publishes at once), slug, content (blocks), excerpt, taxonomy fields (term IDs), and the rest. Answers the entry with its id and rev.',
        inputSchema: schema({ collection, fields: obj('The fields, as the collection declares them.') }, ['collection', 'fields']), annotations: WRITE,
        async run(input, { c }) { return manage.entryCreate(c, string(input.collection), fields(input.fields)); },
    },
    {
        name: 'update_entry', description: 'Change some fields of an entry; the others stay. Send rev from get_entry to avoid overwriting a change made meanwhile. Use publish_entry and unpublish_entry to change where it is published.',
        inputSchema: schema({ collection, id, fields: obj('The fields to change.'), rev }, ['collection', 'id', 'fields']), annotations: CHANGE,
        async run(input, { c }) { return manage.entryUpdate(c, string(input.collection), string(input.id), fields(input.fields), input.rev); },
    },
    {
        name: 'delete_entry', description: 'Delete an entry permanently. To keep it recoverable, set_entry_status to trash instead.',
        inputSchema: schema({ collection, id, rev }, ['collection', 'id']), annotations: DESTROY,
        async run(input, { c }) { await manage.entryDelete(c, string(input.collection), string(input.id), input.rev); return { deleted: true, id: input.id }; },
    },
    {
        name: 'publish_entry', description: 'Publish an entry now, or schedule it with a future at (ISO 8601, UTC). An entry published before keeps its date unless at is given. With "Open notes hold publishing" on, open notes refuse publishing.',
        inputSchema: schema({ collection, id, at: str('When to publish, ISO 8601 such as 2026-12-01T09:00:00Z; a future time schedules. Default: now, or the entry\'s earlier publication time.'), rev }, ['collection', 'id']), annotations: CHANGE,
        async run(input, { c }) { return manage.entryPublish(c, string(input.collection), string(input.id), { at: input.at, rev: input.rev }); },
    },
    {
        name: 'unpublish_entry', description: 'Take an entry off the site: it becomes a draft and keeps its content.',
        inputSchema: schema({ collection, id, rev }, ['collection', 'id']), annotations: CHANGE,
        async run(input, { c }) { return manage.entryUnpublish(c, string(input.collection), string(input.id), { rev: input.rev }); },
    },
    {
        name: 'set_entry_status', description: 'Move an entry to draft, pending (submitted for review), published or trash (recoverable; restore by setting draft).',
        inputSchema: schema({ collection, id, status: str('draft, pending, published or trash.', { enum: ['draft', 'pending', 'published', 'trash'] }), rev }, ['collection', 'id', 'status']), annotations: CHANGE,
        async run(input, { c }) { return manage.entrySetStatus(c, string(input.collection), string(input.id), string(input.status), input.rev); },
    },
    {
        name: 'list_revisions', description: 'An entry\'s revisions, newest first: number, time, who, title and status then.',
        inputSchema: schema({ collection, id, limit: int('How many, 1 to 100 (default 20).', { minimum: 1, maximum: 100 }) }, ['collection', 'id']), annotations: READ,
        async run(input, { c }) { return manage.entryRevisions(c, string(input.collection), string(input.id), query(input, ['limit'])); },
    },
    {
        name: 'get_revision', description: 'The full content of one revision of an entry, to compare before restoring it.',
        inputSchema: schema({ collection, id, revision: int('The revision number.', { minimum: 1 }) }, ['collection', 'id', 'revision']), annotations: READ,
        async run(input, { c }) { return manage.entryRevision(c, string(input.collection), string(input.id), Number(input.revision)); },
    },
    {
        name: 'restore_revision', description: 'Restore a revision\'s fields as a new revision. The entry\'s status, publication time and place stay as they are.',
        inputSchema: schema({ collection, id, revision: int('The revision number to restore.', { minimum: 1 }), rev }, ['collection', 'id', 'revision']), annotations: CHANGE,
        async run(input, { c }) { return manage.entryRestore(c, string(input.collection), string(input.id), Number(input.revision), input.rev); },
    },
    {
        name: 'list_notes', description: 'Review notes: an entry\'s threads (each a root with its replies) when collection and id are given, otherwise the entries with notes across the site. status keeps open or resolved threads.',
        inputSchema: schema({ collection: str('The collection, with id, for one entry\'s notes.'), id: str('The entry ID, with collection.'), status: str('open or resolved.', { enum: ['open', 'resolved'] }), limit: int('Across the site: how many entries, 1 to 100.', { minimum: 1, maximum: 100 }) }), annotations: READ,
        async run(input, { c }) {
            return input.collection && input.id ? manage.notesForEntry(c, string(input.collection), string(input.id), input.status === undefined ? undefined : string(input.status)) : manage.notesAcross(c, input.status === undefined ? undefined : string(input.status), input.limit);
        },
    },
    {
        name: 'add_note', description: 'Leave a review note on an entry (a new thread), or reply to a thread with parentId. target anchors a thread: entry (default), field:<name>, block:<field>:<blockId>, or text:<field>:<blockId>.text with quote for a passage. Mention someone as @[Name](userId).',
        inputSchema: schema({ collection, id, body: str('The note text.'), target: str('entry, field:<name>, block:<field>:<blockId> or text:<field>:<blockId>.text. Default entry.'), quote: str('The quoted passage, for a text target.'), parentId: str('The thread\'s root note ID, for a reply.') }, ['collection', 'id', 'body']), annotations: WRITE,
        async run(input, { c }) { return manage.noteAdd(c, string(input.collection), string(input.id), input); },
    },
    {
        name: 'update_note', description: 'Edit a note\'s body (its author only) or resolve/reopen a thread by its root note (status).',
        inputSchema: schema({ noteId: str('The note ID.'), body: str('The new text.'), status: str('open or resolved, on a thread\'s root.', { enum: ['open', 'resolved'] }) }, ['noteId']), annotations: CHANGE,
        async run(input, { c }) { return manage.noteChange(c, string(input.noteId), input); },
    },
    {
        name: 'delete_note', description: 'Remove a note (its author, or a user administrator); a thread\'s root takes its replies.',
        inputSchema: schema({ noteId: str('The note ID.') }, ['noteId']), annotations: DESTROY,
        async run(input, { c }) { await manage.noteRemove(c, string(input.noteId)); return { deleted: true, noteId: input.noteId }; },
    },
    {
        name: 'list_users', description: 'The site\'s users with their roles, a page at a time. q searches names and emails; role keeps one role\'s holders.',
        inputSchema: schema({ q: str('Search words.'), role: str('A role ID, such as editor.'), page, perPage }), annotations: READ,
        async run(input, { c }) { return manage.usersList(c, query(input, ['q', 'role', 'page', 'perPage'])); },
    },
    {
        name: 'get_user', description: 'One user by ID or email.',
        inputSchema: schema({ id: str('The user ID, or an email address.') }, ['id']), annotations: READ,
        async run(input, { c }) { return manage.userGet(c, string(input.id)); },
    },
    {
        name: 'create_user', description: 'Create a user with an email, a password (8+ characters) and optional name and roles (role IDs; role managers only; otherwise the default role).',
        inputSchema: schema({ email: str('The email address.'), password: str('At least 8 characters.'), name: str('The display name.'), roles: { type: 'array', description: 'Role IDs, such as ["editor"].', items: { type: 'string' } } }, ['email', 'password']), annotations: WRITE,
        async run(input, { c }) { return manage.userCreate(c, input); },
    },
    {
        name: 'update_user', description: 'Change a user\'s name, email, password, roles (role managers) or status (active or disabled).',
        inputSchema: schema({ id: str('The user ID.'), name: str('The display name.'), email: str('The email address.'), password: str('A new password, 8+ characters.'), roles: { type: 'array', description: 'The complete list of role IDs.', items: { type: 'string' } }, status: str('active or disabled.', { enum: ['active', 'disabled'] }) }, ['id']), annotations: CHANGE,
        async run(input, { c }) { return manage.userUpdate(c, string(input.id), input); },
    },
    {
        name: 'delete_user', description: 'Delete a user (on an added site, remove the member). Their content keeps its author. Never your own account.',
        inputSchema: schema({ id: str('The user ID.') }, ['id']), annotations: DESTROY,
        async run(input, { c }) { await manage.userDelete(c, string(input.id)); return { deleted: true, id: input.id }; },
    },
    {
        name: 'list_roles', description: 'The roles with their permissions and how many users hold each.',
        inputSchema: schema({}), annotations: READ,
        async run(_input, { c }) { return manage.rolesList(c); },
    },
    {
        name: 'get_settings', description: 'The settings you may edit as { group: { field: value } }, or one group with its fields described (general, reading, writing, discussion, seo, media, …).',
        inputSchema: schema({ group: str('A settings group ID, for its values and field descriptions.') }), annotations: READ,
        async run(input, { c }) { return manage.settingsRead(c, input.group === undefined ? undefined : string(input.group)); },
    },
    {
        name: 'update_settings', description: 'Change some fields of a settings group; the others keep their values. Read the group first for its field names and kinds.',
        inputSchema: schema({ group: str('The settings group ID.'), values: obj('Field values, such as { "siteTitle": "My site" }.') }, ['group', 'values']), annotations: CHANGE,
        async run(input, { c }) { return manage.settingsUpdate(c, string(input.group), fields(input.values)); },
    },
    {
        name: 'list_taxonomies', description: 'The taxonomies (categories, tags and others) with whether their terms nest.',
        inputSchema: schema({}), annotations: READ,
        async run(_input, { c }) { return manage.taxonomiesList(c); },
    },
    {
        name: 'list_terms', description: 'A taxonomy\'s terms with their IDs, which entries\' taxonomy fields hold. q searches names.',
        inputSchema: schema({ taxonomy: str('The taxonomy, such as categories.'), q: str('Search words.'), page, perPage: int('Terms per page, 1 to 200.', { minimum: 1, maximum: 200 }) }, ['taxonomy']), annotations: READ,
        async run(input, { c }) { return manage.termsList(c, string(input.taxonomy), query(input, ['q', 'page', 'perPage'])); },
    },
    {
        name: 'create_term', description: 'Create a term (a category, a tag, …) in a taxonomy.',
        inputSchema: schema({ taxonomy: str('The taxonomy, such as categories.'), name: str('The term\'s name.'), slug: str('The URL slug; made from the name when left out.'), description: str('A description.'), parent: str('The parent term ID, in a hierarchical taxonomy.') }, ['taxonomy', 'name']), annotations: WRITE,
        async run(input, { c }) { return manage.termCreate(c, string(input.taxonomy), input); },
    },
    {
        name: 'update_term', description: 'Rename or move a term, or change its slug or description.',
        inputSchema: schema({ taxonomy: str('The taxonomy.'), id: str('The term ID.'), name: str('A new name.'), slug: str('A new slug.'), description: str('A new description.'), parent: str('A new parent term ID, or an empty string for the top level.') }, ['taxonomy', 'id']), annotations: CHANGE,
        async run(input, { c }) { return manage.termUpdate(c, string(input.taxonomy), string(input.id), input); },
    },
    {
        name: 'delete_term', description: 'Delete a term; entries keep their other terms.',
        inputSchema: schema({ taxonomy: str('The taxonomy.'), id: str('The term ID.') }, ['taxonomy', 'id']), annotations: DESTROY,
        async run(input, { c }) { await manage.termDelete(c, string(input.taxonomy), string(input.id)); return { deleted: true, id: input.id }; },
    },
    {
        name: 'list_media', description: 'Files in the media library (their IDs go in media fields and image blocks). q searches titles and names; kind keeps image, video, audio, document or archive files.',
        inputSchema: schema({ q: str('Search words.'), kind: str('image, video, audio, document or archive.', { enum: ['image', 'video', 'audio', 'document', 'archive'] }) }), annotations: READ,
        async run(input, { c }) { return manage.mediaList(c, query(input, ['q', 'kind'])); },
    },
    {
        name: 'list_sites', description: 'The network\'s sites (network admins, on the network host): the main site first, then the added sites with their addresses and status. Reach another site by connecting with ?site=<id>.',
        inputSchema: schema({ q: str('Search names and addresses.'), status: str('active, archived or deleted.', { enum: ['active', 'archived', 'deleted'] }), page, perPage: int('Sites per page, 1 to 200.', { minimum: 1, maximum: 200 }) }), annotations: READ,
        async run(input, { c }) { return manage.sitesList(c, query(input, ['q', 'status', 'page', 'perPage'])); },
    },
    {
        name: 'get_network_site', description: 'One site of the network with its domains (main for the main site).',
        inputSchema: schema({ id: str('The site ID.') }, ['id']), annotations: READ,
        async run(input, { c }) { return manage.siteGet(c, string(input.id)); },
    },
    {
        name: 'create_site', description: 'Add a site to the network: a name, an address under the network\'s subdomain (blog.example.com), its first administrator (a network account\'s email; yours when left out), a language, and starter content unless starter is false.',
        inputSchema: schema({ name: str('The site\'s name.'), host: str('Its address, such as blog.example.com.'), admin: str('The first administrator\'s email (a network account).'), language: str('A language code, such as en.'), starter: bool('Start with a first post, a category, a contact form and its page (default true).'), id: str('The site ID; made from the name when left out.') }, ['name', 'host']), annotations: WRITE,
        async run(input, { c }) { return manage.siteCreate(c, input); },
    },
    {
        name: 'set_site_status', description: 'Archive a site (visitors get 503, members keep the dashboard), restore it (active), or delete it (recoverable for 30 days).',
        inputSchema: schema({ id: str('The site ID.'), status: str('active, archived or deleted.', { enum: ['active', 'archived', 'deleted'] }) }, ['id', 'status']), annotations: DESTROY,
        async run(input, { c }) { return manage.siteSetStatus(c, string(input.id), input.status); },
    },
];

/** A CMS refusal or validation problem becomes the tool's error result; anything else is a failure. */
export function toolError(error: unknown): { message: string; data?: unknown } | null {
    if (isCmsError(error)) return { message: error.message, data: { error: error.message, code: error.code, ...(error.fields ? { fields: error.fields } : {}) } };
    if (error instanceof ClientVisibleError) return { message: error.message, data: { error: error.message, code: 'CMS_VALIDATION' } };
    return null;
}

/** What the client's model reads after connecting: how this site's content works. */
export async function siteInstructions(c: Context): Promise<string> {
    const cms = c.get('cms');
    const title = String(await cms.settings.get('general.siteTitle').catch(() => '')) || 'this site';
    const collections = cms.collections().map(entry => `${entry.name} (${entry.label}${entry.publishable === false ? ', not published' : ''})`).join(', ');
    return [
        `You manage ${title}, a Cossack CMS site. Call get_site first for who you are and what the site has.`,
        `Collections: ${collections || 'none yet'}. Entries have id, rev, status (draft, pending, scheduled, published, trash) and publishedAt; list_collections names every field.`,
        'Change entries with update_entry (fields only), publish_entry (now, or at a future time to schedule) and unpublish_entry. Read an entry before changing it and pass its rev.',
        'Rich text fields are ProseMirror JSON documents ({ "type": "doc", "content": [...] }); content fields are block arrays ({ "_id", "type", "data" }). get_collection_schema gives the exact shapes.',
        'Taxonomy fields hold term IDs from list_terms. Media fields hold file IDs from list_media.',
        'Review notes live on entries (list_notes, add_note); resolving a thread uses update_note with status resolved.',
        'Destructive tools (delete_*, set_site_status) are final or hard to undo: confirm intent before calling them.',
    ].join('\n');
}
