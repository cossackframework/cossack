/**
 * The entry's room: one live instance per entry (`transport: 'durable-object'`), shared by
 * every editor of it, on Workers as a Durable Object and on Node in the process. The room is
 * the authority of the shared draft: it holds the entry's values, applies every change in the
 * order it receives them (the action queue), broadcasts each one, and keeps the draft in
 * `cms_drafts` between saves. See `collab.ts` in the CMS package for the convergence rules.
 *
 * - Scalars: `set` replaces a field's value; editors apply the pending-key rule.
 * - Blocks: `tree` applies one op by block ID and answers with the tree's hash; `blocks`
 *   returns a field's tree to an editor whose hash differs.
 * - Rich text: `steps` is the `prosemirror-collab` authority of one document, applying a batch
 *   to the shared schema and logging it; `richText` returns a document to start over from.
 * - Presence: `presence` carries a tab's focus, selection and drag; `participants` groups the
 *   peers by user for the header; the draft row names who is editing, for the entries list.
 *
 * Saving stays the editor page's HTTP action; `saved` tells the room, which reads the record
 * again and refreshes everyone. A record changed outside the room sets `diverged`.
 */
import { Client, Component, Cossack, OnEvent, OnWindow, Server, State, defineServerMiddleware } from '@cossackframework/core';
import { html, type TemplateResult } from '@cossackframework/renderer';
import type { Context, MiddlewareHandler } from 'hono';
import { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Step } from '@tiptap/pm/transform';
import {
    applyTreeOp, checkNoteAction, checkPresence, CmsError, expiredPeers, findBlock, groupPeers, hasPermission, htmlBlocksChanged, isCmsError, livePeers, parseRichTextPath, participantColor, PERMISSIONS, richTextProblem, stableJson, StepLog, systemPrincipal, treeHash, updateBlock,
    type Block, type Note, type NoteAction, type NoteRange, type Participant, type PeerPresence, type PeerState, type Principal, type RichTextDoc, type TreeOp,
} from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';
import { editorView, entryValues, routeResource } from '../content';
import type { EditorValues, EditorView } from '../editor';
import { collabEditors } from '../rich-text-field';
import type { CollabTransport, StepsResult } from '../rich-text.client';
import { richTextSchema } from '../rich-text-schema';
import { mailOrigin } from '../seo';
import { avatarStack, type Someone } from './presence';

const PEER = /^[A-Za-z0-9_-]{8,64}$/;
/** Peer IDs one user may hold in a room at once (a tab each), and in all. */
const PEERS_PER_USER = 50;
const PEER_OWNERS_MAX = 10_000;
/** How long a silent peer ID stays its owner's before another user's claim may free it, when the room is full of IDs. */
const PEER_GRACE = 24 * 60 * 60 * 1000;
/** A scalar value or a block op, as JSON, at most. */
const VALUE_MAX = 64 * 1024;
/** Steps in one batch, at most; a paste is one step. */
const STEPS_MAX = 500;
/** The draft is written this long after the last change, and at least this often while changes keep coming. */
const PERSIST_IDLE = 1000;
const PERSIST_MAX = 5000;
/** How often a room with people in it says so in the draft row, and prunes peers that fell silent. */
const EDITORS_EVERY = 30_000;
/** Editors send their presence at least this often, so the room's timeout never fires on an idle tab. */
const HEARTBEAT = 15_000;
/**
 * Editors' access by user and entry: a guard runs for every frame to every peer. `checked` is
 * when the database last answered yes; `until` is when to ask again.
 */
const RECENT_ACCESS = new Map<string, { checked: number; until: number }>();
const ACCESS_TTL = 5000;
/** While the database cannot answer, an earlier yes holds this long after it was given, then the editor is refused. */
export const ACCESS_GRACE = 3 * ACCESS_TTL;
/** While the database cannot answer, frames ask again at most this often. */
export const ACCESS_BACKOFF = 1000;

/** Forget every kept access decision (tests). */
export function clearRoomAccess(): void { RECENT_ACCESS.clear(); }

const forbidden = (c: Context) => c.json({ error: 'Forbidden', code: 'COSSACK_RPC_FORBIDDEN' }, 403);

/** The room's key: one instance per entry of a site. Fails closed without an entry. */
export function entryScope(c: Context): string {
    const collection = c.req.param('collection');
    const id = c.req.param('id');
    const site = (c.get('site') as { id?: string } | undefined)?.id ?? 'main';
    if (!collection || !id || id === 'new') throw Object.assign(new Error('An entry room needs a saved entry.'), { authorizationCode: 'COSSACK_AUTH_FORBIDDEN' });
    return `site:${site}:${collection}:${id}`;
}

/** A dashboard user who may edit the entry; the check is kept for a few seconds, since it runs again for every frame. */
export const requireEntryEditor: MiddlewareHandler = defineServerMiddleware(async (c, next) => {
    const cms = c.get('cms') as CmsHost | undefined;
    const principal = c.get('principal') as Principal | undefined;
    const route = c.req.param('collection');
    const id = c.req.param('id');
    if (!cms || !principal || principal.kind !== 'user' || !route || !id || id === 'new') return forbidden(c);
    const key = `${principal.id}:${(c.get('site') as { id?: string } | undefined)?.id ?? 'main'}:${route}:${id}`;
    const now = Date.now();
    const previous = RECENT_ACCESS.get(key);
    if (!previous || previous.until <= now) {
        let allowed = false;
        try {
            const { resource } = routeResource(cms, route);
            const repository = cms.resource(resource.id);
            const record = await repository.get(id, { principal });
            allowed = record !== null && repository.canUpdate(record, principal);
        } catch (error) {
            // Only a passing database error keeps an earlier yes, and only for a while: a lost
            // entry, collection or right, an inactive plugin or a pending migration refuses.
            const passing = !isCmsError(error) || ((error.code === 'CMS_UNAVAILABLE' || error.code === 'CMS_UNCERTAIN') && !error.lasting);
            if (!passing || !previous || now - previous.checked > ACCESS_GRACE) { RECENT_ACCESS.delete(key); return forbidden(c); }
            console.warn('[cms] the room could not check access again; it keeps the last answer for now', error);
            RECENT_ACCESS.set(key, { checked: previous.checked, until: now + ACCESS_BACKOFF });
            await next();
            return;
        }
        if (!allowed) { RECENT_ACCESS.delete(key); return forbidden(c); }
        if (RECENT_ACCESS.size >= 1000) for (const [entry, kept] of RECENT_ACCESS) if (now - kept.checked > ACCESS_GRACE) RECENT_ACCESS.delete(entry);
        RECENT_ACCESS.set(key, { checked: now, until: now + ACCESS_TTL });
    }
    await next();
});

/** What `join` answers: the room's draft as it stands. */
export interface RoomSnapshot {
    values: EditorValues;
    /** Rich text versions by document path. */
    versions: Record<string, number>;
    /** Tree hashes by blocks field. */
    hashes: Record<string, string>;
    rev: number;
    peers: PeerState[];
    /** The entry's notes, roots and replies, oldest first. */
    notes: Note[];
    /** The people the notes name, by user ID: their authors, and everyone who joined. */
    people: Record<string, Someone>;
}

/** What the room tells every tab about a note. */
export type NoteChange =
    | { kind: 'created'; note: Note; author: Someone }
    | { kind: 'edited'; note: Note }
    | { kind: 'status'; note: Note }
    | { kind: 'removed'; ids: string[] }
    | { kind: 'moved'; moves: { id: string; range: NoteRange }[] };

/** What the editor page does with the room, in the browser. */
export interface RoomHandle {
    /** This browser tab's ID in the room. */
    readonly peer: string;
    set(field: string, value: unknown): Promise<{ applied: boolean }>;
    tree(op: TreeOp): Promise<{ applied: boolean; hash: string }>;
    blocks(field: string): Promise<{ blocks: Block[]; hash: string }>;
    /** The room as one rich text document's authority, for its editor. */
    transport(path: string): CollabTransport;
    /** The room's draft as it stands, before a save. */
    fresh(): Promise<RoomSnapshot>;
    /** Where this tab is now; sent at once, merged into what was sent before. */
    presence(state: PeerPresence): void;
    /** The page saved the entry: the room reads it again and refreshes everyone. */
    saved(): Promise<void>;
    /** Start the draft over from the record, after a change outside the room. */
    reload(): Promise<void>;
    /** Leave, change, resolve or remove a note; everyone hears of it. Answers the note made or changed. */
    note(action: NoteAction): Promise<Note | null>;
}

export type EntryRoomProps = {
    /** The room is ready to be talked to. */
    onReady(handle: RoomHandle): void;
    /** The room's draft, on joining and after a save or a reload: replace the values; `resets` names rich text documents to load again. */
    onSnapshot(snapshot: RoomSnapshot, options: { initial: boolean; resets: readonly string[] }): void;
    onSet(peer: string, field: string, value: unknown): void;
    onTree(peer: string, op: TreeOp, hash: string): void;
    /** The peers in the room, this tab included. */
    onPeers(peers: readonly PeerState[], self: string): void;
    onSaved(by: string, rev: number): void;
    /** A note was made, changed, resolved, removed or moved, by anyone in the room, this tab included. */
    onNote(change: NoteChange): void;
    /** Connection and draft state for the page's indicators. */
    onStatus(status: { connected: boolean; dirty: boolean; diverged: boolean; oversized: boolean }): void;
};

type ServerBlocksResult = { blocks: Block[]; hash: string };

@Component({ transport: 'durable-object', scope: entryScope, middlewares: [requireEntryEditor] })
export class EntryRoom extends Cossack {
    declare props: EntryRoomProps;
    /** The record's revision as the room last saw it saved. */
    @State() rev = 0;
    @State() dirty = false;
    /** The record changed outside the room since the draft started. */
    @State() diverged = false;
    /** The draft outgrew what a RomeDB request carries: it lives in memory alone until it is saved. */
    @State() oversized = false;
    @State() participants: Participant[] = [];

    // --- Server: the shared draft ------------------------------------------------------------
    private cmsHost: CmsHost | undefined;
    private view: EditorView | undefined;
    private resourceId = '';
    private entryId = '';
    private values: EditorValues = {};
    private scalarFields = new Set<string>();
    private blockFields = new Set<string>();
    private richFields = new Set<string>();
    /** Fields with an `access` rule of their own, kept out of the room. */
    private restricted = new Set<string>();
    /** Rich text keys by block type. */
    private richKeys = new Map<string, Set<string>>();
    private docs = new Map<string, ProseMirrorNode>();
    private logs = new Map<string, StepLog>();
    private roomPeers = new Map<string, PeerState>();
    /**
     * Who each peer ID belongs to: the first user to use it. Tabs learn every peer's ID from the
     * presence broadcasts, so a call naming a peer of another user is refused.
     */
    private peerOwners = new Map<string, string>();
    /** How many peer IDs each user holds in `peerOwners`. */
    private ownedPeers = new Map<string, number>();
    /** When each owned peer ID was last used by its owner. */
    private peerSeen = new Map<string, number>();
    /** The entry's notes as the room holds them, the authority while it lives; `cms.notes` keeps them. */
    private notes: Note[] = [];
    /** Who the notes and the peers name, so tabs show names without looking anyone up. */
    private people = new Map<string, Someone>();
    private baseRev = 0;
    private entryLoading: Promise<void> | undefined;
    private persistTimer: ReturnType<typeof setTimeout> | undefined;
    private persistSince = 0;
    private editorsTimer: ReturnType<typeof setInterval> | undefined;

    /** The request's CMS and principal; the guard made sure of both. */
    private contextOf(): { cms: CmsHost; principal: Principal & { kind: 'user' } } {
        const cms = this.c.get('cms') as CmsHost;
        const principal = this.c.get('principal') as Principal;
        if (!cms || principal?.kind !== 'user') throw new Error('The room needs a signed-in editor.');
        return { cms, principal };
    }

    /** Load the entry once: its draft when one is newer than the record, else the record itself. */
    private load(cms: CmsHost): Promise<void> {
        return this.entryLoading ??= (async () => {
            const route = this.c.req.param('collection') ?? '';
            const id = this.c.req.param('id') ?? '';
            const view = await editorView(cms, route);
            const { resource } = routeResource(cms, route);
            const record = await cms.resource(resource.id).get(id, { principal: systemPrincipal('collab') });
            if (!record) throw new Error('The entry does not exist.');
            this.cmsHost = cms;
            this.view = view;
            this.resourceId = resource.id;
            this.entryId = id;
            // Fields with their own read or write rule are not shared: each editor reads and saves them as the repository lets them.
            this.restricted = new Set(view.restricted);
            // A multiple rich text field is a list of documents: it travels as one value, like a scalar.
            for (const field of view.fields) {
                if (this.restricted.has(field.name)) continue;
                if (field.kind === 'blocks') this.blockFields.add(field.name);
                else if (field.kind === 'richtext' && !field.multiple) this.richFields.add(field.name);
            }
            for (const option of view.blocks) {
                const keys = option.fields.filter(field => field.kind === 'richtext').map(field => field.name);
                if (keys.length) this.richKeys.set(option.name, new Set(keys));
            }
            const values = this.shared(await entryValues(cms, view, record));
            for (const name of Object.keys(values)) if (!this.blockFields.has(name) && !this.richFields.has(name)) this.scalarFields.add(name);
            this.rev = record.rev;
            this.baseRev = record.rev;
            const draft = await cms.drafts.get(resource.id, id).catch(() => null);
            if (draft && draft.at > record.updatedAt && draft.baseRev === record.rev && Object.keys(draft.values).length) {
                this.values = { ...values, ...this.shared(draft.values) };
                for (const [path, version] of Object.entries(draft.versions)) if (Number.isSafeInteger(version) && version >= 0) this.logs.set(path, new StepLog(version));
                this.dirty = true;
            } else this.values = values;
            this.notes = await cms.notes.forEntry(resource.id, id).catch(() => []);
            await this.know(cms, this.notes.map(note => note.userId));
        })().catch(error => { this.entryLoading = undefined; throw error; });
    }

    /** The values without the restricted fields, which never enter the room's draft, snapshots or broadcasts. */
    private shared(values: EditorValues): EditorValues {
        return Object.fromEntries(Object.entries(values).filter(([name]) => !this.restricted.has(name)));
    }

    /** Make sure the people are known by name and picture, looking up those who are not yet. */
    private async know(cms: CmsHost, userIds: readonly string[]): Promise<void> {
        const missing = [...new Set(userIds)].filter(id => !this.people.has(id));
        if (!missing.length) return;
        const users = await cms.users.getMany(missing).catch(() => new Map());
        for (const id of missing) {
            const user = users.get(id);
            this.people.set(id, { user: id, name: user?.name || user?.email || id, avatar: user?.avatar ?? null, color: participantColor(id) });
        }
    }

    private richTextAt(path: string): { field: string; block?: { id: string; key: string } } | null {
        const parsed = parseRichTextPath(path);
        if (!parsed) return null;
        if (parsed.block) {
            if (!this.blockFields.has(parsed.field)) return null;
            const block = findBlock((this.values[parsed.field] as Block[] | undefined) ?? [], parsed.block.id);
            if (!block || !this.richKeys.get(block.type)?.has(parsed.block.key)) return null;
            return parsed;
        }
        return this.richFields.has(parsed.field) ? parsed : null;
    }

    private docJson(path: { field: string; block?: { id: string; key: string } }, values: EditorValues = this.values): RichTextDoc | null {
        const value = path.block
            ? findBlock((values[path.field] as Block[] | undefined) ?? [], path.block.id)?.data[path.block.key]
            : values[path.field];
        return value && typeof value === 'object' && (value as RichTextDoc).type === 'doc' ? value as RichTextDoc : null;
    }

    private docAt(path: string, at: { field: string; block?: { id: string; key: string } }): ProseMirrorNode {
        let doc = this.docs.get(path);
        if (!doc) {
            const json = this.docJson(at);
            doc = json && json.content.length ? ProseMirrorNode.fromJSON(richTextSchema(), json) : richTextSchema().topNodeType.createAndFill()!;
            this.docs.set(path, doc);
        }
        return doc;
    }

    private logAt(path: string): StepLog {
        let log = this.logs.get(path);
        if (!log) { log = new StepLog(); this.logs.set(path, log); }
        return log;
    }

    private writeDoc(at: { field: string; block?: { id: string; key: string } }, doc: RichTextDoc): void {
        if (at.block) {
            const { id, key } = at.block;
            this.values = { ...this.values, [at.field]: updateBlock((this.values[at.field] as Block[] | undefined) ?? [], id, block => ({ ...block, data: { ...block.data, [key]: doc } })) };
        } else this.values = { ...this.values, [at.field]: doc };
    }

    private versions(): Record<string, number> {
        return Object.fromEntries([...this.logs].map(([path, log]) => [path, log.version]));
    }

    private hashes(): Record<string, string> {
        return Object.fromEntries([...this.blockFields].map(field => [field, treeHash((this.values[field] as Block[] | undefined) ?? [])]));
    }

    private snapshot(): RoomSnapshot {
        return { values: this.values, versions: this.versions(), hashes: this.hashes(), rev: this.rev, peers: [...this.roomPeers.values()], notes: this.notes, people: Object.fromEntries(this.people) };
    }

    /** A change happened: the draft is dirty and gets written soon. */
    private changed(): void {
        this.dirty = true;
        const now = Date.now();
        if (!this.persistSince) this.persistSince = now;
        if (this.persistTimer) clearTimeout(this.persistTimer);
        const wait = Math.max(0, Math.min(PERSIST_IDLE, this.persistSince + PERSIST_MAX - now));
        this.persistTimer = setTimeout(() => { void this.persist(); }, wait);
    }

    private async persist(): Promise<void> {
        this.persistTimer = undefined;
        this.persistSince = 0;
        const cms = this.cmsHost;
        if (!cms) return;
        try {
            await cms.drafts.save(this.resourceId, this.entryId, { baseRev: this.baseRev, values: this.values, versions: this.versions(), editors: this.editors() });
            if (this.oversized) this.oversized = false;
        } catch (error) {
            if ((error as { code?: string }).code === 'CMS_LIMIT') { if (!this.oversized) this.oversized = true; }
            else console.error('[cms] the shared draft could not be written', error);
        }
    }

    private editors(): string[] {
        return [...new Set(livePeers(this.roomPeers.values(), Date.now()).map(peer => peer.user))];
    }

    /** Peers that fell silent leave, and every tab hears it; the participants follow; the draft row names who is here. */
    private presenceChanged(): void {
        for (const id of expiredPeers(this.roomPeers.values(), Date.now())) {
            this.roomPeers.delete(id);
            // The ID stays its owner's: an idle tab that wakes up takes its place again, and
            // nobody else who heard the ID in presence can claim it meanwhile.
            this.broadcastEvent('left', id);
        }
        const participants = groupPeers(this.roomPeers.values());
        if (stableJson(participants) !== stableJson(this.participants)) this.participants = participants;
        if (this.roomPeers.size && !this.editorsTimer) this.editorsTimer = setInterval(() => { this.presenceChanged(); void this.reportEditors(); }, EDITORS_EVERY);
        if (!this.roomPeers.size && this.editorsTimer) { clearInterval(this.editorsTimer); this.editorsTimer = undefined; }
    }

    private async reportEditors(): Promise<void> {
        const cms = this.cmsHost;
        if (!cms) return;
        await cms.drafts.editing(this.resourceId, this.entryId, this.editors()).catch(() => undefined);
    }

    /** The record's revision moved without the room: someone wrote it elsewhere. */
    private async checkDivergence(cms: CmsHost): Promise<void> {
        const record = await cms.resource(this.resourceId).get(this.entryId, { principal: systemPrincipal('collab') }).catch(() => null);
        const diverged = !record || record.rev !== this.baseRev;
        if (diverged !== this.diverged) this.diverged = diverged;
    }

    /** Start the draft over from the record: values, rich text logs at new versions, nothing pending. */
    private async restart(cms: CmsHost, resets: string[]): Promise<RoomSnapshot> {
        const record = await cms.resource(this.resourceId).get(this.entryId, { principal: systemPrincipal('collab') });
        if (!record) throw new Error('The entry does not exist.');
        const values = this.shared(await entryValues(cms, this.view!, record));
        // A document the record holds differently from the room restarts its log, so editors load it again.
        for (const [path, log] of this.logs) {
            const at = parseRichTextPath(path);
            if (!at || stableJson(this.docJson(at)) !== stableJson(this.docJson(at, values)) || resets.includes(path)) {
                this.logs.set(path, new StepLog(log.version + 1000));
                this.docs.delete(path);
                if (!resets.includes(path)) resets.push(path);
            }
        }
        this.values = values;
        this.rev = record.rev;
        this.baseRev = record.rev;
        this.dirty = false;
        this.diverged = false;
        await this.persist();
        return this.snapshot();
    }

    /** The peer ID when it is well formed and belongs to the caller (claimed on first use), else null. */
    private ownPeer(peer: unknown, principal: Principal & { kind: 'user' }): string | null {
        if (typeof peer !== 'string' || !PEER.test(peer)) return null;
        const owner = this.peerOwners.get(peer);
        if (owner !== undefined) {
            if (owner !== principal.id) return null;
            this.peerSeen.set(peer, Date.now());
            return peer;
        }
        // A user claims a few IDs (one per tab); claims past that first give up the user's own
        // silent ones. A peer still in the room is never given up, so its ID cannot be taken over.
        if ((this.ownedPeers.get(principal.id) ?? 0) >= PEERS_PER_USER && !this.releaseSilent(owned => owned === principal.id)) return null;
        if (this.peerOwners.size >= PEER_OWNERS_MAX && !this.releaseSilent(() => true, Date.now() - PEER_GRACE)) return null;
        this.peerOwners.set(peer, principal.id);
        this.peerSeen.set(peer, Date.now());
        this.ownedPeers.set(principal.id, (this.ownedPeers.get(principal.id) ?? 0) + 1);
        return peer;
    }

    /**
     * Give up the oldest claimed ID whose peer is not in the room, whose owner matches and, with
     * `silentSince`, that was last used before then; false when there is none.
     */
    private releaseSilent(matches: (owner: string) => boolean, silentSince = Infinity): boolean {
        for (const [id, owner] of this.peerOwners) {
            if (this.roomPeers.has(id) || !matches(owner) || (this.peerSeen.get(id) ?? 0) >= silentSince) continue;
            this.releasePeer(id);
            return true;
        }
        return false;
    }

    /** A peer left: its ID is free again. */
    private releasePeer(id: string): void {
        const owner = this.peerOwners.get(id);
        if (owner === undefined) return;
        this.peerOwners.delete(id);
        this.peerSeen.delete(id);
        const count = (this.ownedPeers.get(owner) ?? 1) - 1;
        if (count > 0) this.ownedPeers.set(owner, count); else this.ownedPeers.delete(owner);
    }

    /** A tab's state as the room keeps it: the user's name and picture, looked up when the tab arrives. */
    private async peerState(cms: CmsHost, peer: string, userId: string, presence: unknown): Promise<PeerState> {
        const user = await cms.users.get(userId).catch(() => null);
        const state: PeerState = { peer, user: userId, name: user?.name || user?.email || userId, avatar: user?.avatar ?? null, color: participantColor(userId), at: Date.now(), presence: checkPresence(presence) };
        this.people.set(userId, { user: userId, name: state.name, avatar: state.avatar, color: state.color });
        return state;
    }

    @Server()
    async join(peer: unknown, presence: unknown): Promise<RoomSnapshot> {
        const { cms, principal } = this.contextOf();
        await this.load(cms);
        if (!this.ownPeer(peer, principal)) throw new Error('Invalid peer.');
        const state = await this.peerState(cms, peer as string, principal.id, presence);
        // Notes written outside the room (the API) show to whoever joins next.
        this.notes = await cms.notes.forEntry(this.resourceId, this.entryId).catch(() => this.notes);
        await this.know(cms, this.notes.map(note => note.userId));
        this.roomPeers.set(peer as string, state);
        this.presenceChanged();
        this.broadcastEvent('presence', state);
        void this.reportEditors();
        await this.checkDivergence(cms);
        return this.snapshot();
    }

    /**
     * Whether the change adds or alters a Custom HTML block the editor may not post. The room's
     * draft is saved by whoever presses Save, so the check is made here, per editor.
     */
    private htmlRefused(principal: Principal, next: unknown, previous: unknown): boolean {
        return !hasPermission(principal, PERMISSIONS.unfilteredHtml) && htmlBlocksChanged(next, previous);
    }

    @Server()
    async set(peer: unknown, field: unknown, value: unknown): Promise<{ applied: boolean }> {
        const { cms, principal } = this.contextOf();
        await this.load(cms);
        if (!this.ownPeer(peer, principal) || typeof field !== 'string' || !this.scalarFields.has(field) || stableJson(value).length > VALUE_MAX) return { applied: false };
        if (this.htmlRefused(principal, value, this.values[field])) return { applied: false };
        this.values = { ...this.values, [field]: value };
        this.changed();
        this.broadcastEvent('set', peer, field, value);
        return { applied: true };
    }

    @Server()
    async tree(peer: unknown, op: unknown): Promise<{ applied: boolean; hash: string }> {
        const { cms, principal } = this.contextOf();
        await this.load(cms);
        const checked = this.ownPeer(peer, principal) ? this.checkOp(op) : null;
        const field = checked?.field ?? '';
        const current = (this.values[field] as Block[] | undefined) ?? [];
        if (!checked) return { applied: false, hash: treeHash(current) };
        const next = applyTreeOp(current, checked);
        if (!next || this.htmlRefused(principal, next, current)) return { applied: false, hash: treeHash(current) };
        this.values = { ...this.values, [field]: next };
        for (const path of this.docs.keys()) if (path.startsWith(`${field}:`) && !this.richTextAt(path)) { this.docs.delete(path); this.logs.delete(path); }
        this.changed();
        const hash = treeHash(next);
        this.broadcastEvent('tree', peer, checked, hash);
        return { applied: true, hash };
    }

    /** A tree op from client input: known kinds, a blocks field, bounded size, and no patch of a rich text key (its steps own it). */
    private checkOp(value: unknown): TreeOp | null {
        if (!value || typeof value !== 'object' || stableJson(value).length > VALUE_MAX) return null;
        const op = value as Record<string, unknown>;
        if (typeof op.field !== 'string' || !this.blockFields.has(op.field)) return null;
        const id = typeof op.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(op.id) ? op.id : null;
        const anchor = (entry: unknown): entry is string | null => entry === null || (typeof entry === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(entry));
        switch (op.kind) {
            case 'insert': return op.block && typeof op.block === 'object' && anchor(op.parent) && anchor(op.after) ? { kind: 'insert', field: op.field, block: op.block as Block, parent: op.parent, after: op.after } : null;
            case 'move': return id && anchor(op.parent) && anchor(op.after) ? { kind: 'move', field: op.field, id, parent: op.parent, after: op.after } : null;
            case 'remove': return id ? { kind: 'remove', field: op.field, id } : null;
            case 'patch': {
                if (!id || typeof op.path !== 'string') return null;
                const block = findBlock((this.values[op.field] as Block[] | undefined) ?? [], id);
                if (block && op.path.startsWith('data.') && this.richKeys.get(block.type)?.has(op.path.slice(5))) return null;
                return { kind: 'patch', field: op.field, id, path: op.path, ...('value' in op ? { value: op.value } : {}) };
            }
            default: return null;
        }
    }

    @Server()
    async blocks(field: unknown): Promise<ServerBlocksResult> {
        const { cms } = this.contextOf();
        await this.load(cms);
        const blocks = typeof field === 'string' && this.blockFields.has(field) ? (this.values[field] as Block[] | undefined) ?? [] : [];
        return { blocks, hash: treeHash(blocks) };
    }

    @Server()
    async steps(peer: unknown, path: unknown, version: unknown, steps: unknown, clientID: unknown): Promise<StepsResult> {
        const { cms, principal } = this.contextOf();
        await this.load(cms);
        const at = typeof path === 'string' ? this.richTextAt(path) : null;
        if (!at || !this.ownPeer(peer, principal) || typeof clientID !== 'string' || clientID.length > 64 || !Number.isSafeInteger(version) || !Array.isArray(steps) || steps.length > STEPS_MAX) return { status: 'reload' };
        const log = this.logAt(path as string);
        if (!log.accepts(version as number)) {
            const since = log.since(version as number);
            return since ? { status: 'behind', ...since } : { status: 'reload' };
        }
        if (!steps.length) return { status: 'accepted', version: log.version };
        let doc = this.docAt(path as string, at);
        const before = doc;
        try {
            for (const json of steps) {
                const result = Step.fromJSON(richTextSchema(), json).apply(doc);
                if (result.failed || !result.doc) return { status: 'reload' };
                doc = result.doc;
            }
        } catch { return { status: 'reload' }; }
        // ProseMirror attribute objects have no prototype; the validator and the draft want plain JSON.
        const json = JSON.parse(JSON.stringify(doc.toJSON())) as RichTextDoc;
        const problem = richTextProblem(json);
        if (problem || this.htmlRefused(principal, json, before.toJSON())) return { status: 'reload' };
        this.docs.set(path as string, doc);
        this.writeDoc(at, json);
        const next = log.push(steps, clientID);
        this.changed();
        this.broadcastEvent('steps', path, steps, steps.map(() => clientID), next);
        return { status: 'accepted', version: next };
    }

    /** The draft as it stands, for a save: every editor's changes, this tab's included. */
    @Server()
    async draft(): Promise<RoomSnapshot> {
        const { cms } = this.contextOf();
        await this.load(cms);
        return this.snapshot();
    }

    @Server()
    async richText(path: unknown): Promise<{ doc: RichTextDoc | null; version: number }> {
        const { cms, principal } = this.contextOf();
        await this.load(cms);
        const at = typeof path === 'string' ? this.richTextAt(path) : null;
        if (!at) return { doc: null, version: 0 };
        return { doc: JSON.parse(JSON.stringify(this.docAt(path as string, at).toJSON())) as RichTextDoc, version: this.logAt(path as string).version };
    }

    @Server()
    async presence(peer: unknown, state: unknown): Promise<void> {
        const { cms, principal } = this.contextOf();
        await this.load(cms);
        if (!this.ownPeer(peer, principal)) return;
        const known = this.roomPeers.get(peer as string);
        // A tab the room dropped as silent (throttled in the background, or the instance restarted) comes back under its user's name, not their ID.
        const next: PeerState = known ? { ...known, at: Date.now(), presence: checkPresence(state) } : await this.peerState(cms, peer as string, principal.id, state);
        this.roomPeers.set(peer as string, next);
        this.presenceChanged();
        this.broadcastEvent('presence', next);
    }

    /**
     * A note from a tab: stored, applied to the room's threads and told to everyone. Anyone in the
     * room (so, anyone who may edit the entry) leaves, resolves and reopens notes; authors change
     * their own, and authors and user administrators remove them.
     */
    @Server()
    async note(peer: unknown, action: unknown): Promise<Note | null> {
        const { cms, principal } = this.contextOf();
        await this.load(cms);
        if (!this.ownPeer(peer, principal)) throw new CmsError('CMS_VALIDATION', 'Invalid peer.');
        const input = checkNoteAction(action);
        const tell = (change: NoteChange) => this.broadcastEvent('note', change);
        // Webhooks and emails follow from the outbox job the note's write queues; the tab is answered first.
        const announcement = {
            origin: mailOrigin(this.c), route: this.c.req.param('collection') ?? '', collection: this.resourceId.startsWith('cms/') ? this.resourceId.slice(4) : null,
            title: String(this.values[this.view?.titleField ?? 'title'] ?? ''), author: this.people.get(principal.id)?.name ?? principal.id,
        };
        const current = (id: string) => {
            const note = this.notes.find(entry => entry.id === id);
            if (!note) throw new CmsError('CMS_NOT_FOUND', 'The note no longer exists.');
            return note;
        };
        switch (input.kind) {
            case 'create': {
                const note = await cms.notes.create({ resource: this.resourceId, recordId: this.entryId, userId: principal.id, target: input.target, range: input.range ?? null, quote: input.quote ?? '', body: input.body, parentId: input.parentId ?? null }, { announce: announcement });
                cms.outboxWritten();
                await this.know(cms, [principal.id]);
                this.notes = [...this.notes.map(entry => entry.id === note.parentId ? { ...entry, updatedAt: note.createdAt } : entry), note];
                tell({ kind: 'created', note, author: this.people.get(principal.id)! });
                return note;
            }
            case 'edit': {
                if (current(input.id).userId !== principal.id) throw new CmsError('CMS_FORBIDDEN', 'Only its author changes a note.');
                const note = await cms.notes.edit(input.id, input.body);
                if (!note) throw new CmsError('CMS_NOT_FOUND', 'The note no longer exists.');
                this.notes = this.notes.map(entry => entry.id === note.id ? note : entry.id === note.parentId ? { ...entry, updatedAt: note.updatedAt } : entry);
                tell({ kind: 'edited', note });
                return note;
            }
            case 'resolve':
            case 'reopen': {
                if (current(input.id).parentId) throw new CmsError('CMS_VALIDATION', 'Resolve the thread, not a reply.');
                const note = await cms.notes.setStatus(input.id, input.kind === 'resolve' ? 'resolved' : 'open', principal.id, { announce: announcement });
                if (!note) throw new CmsError('CMS_NOT_FOUND', 'The note no longer exists.');
                this.notes = this.notes.map(entry => entry.id === note.id ? note : entry);
                tell({ kind: 'status', note });
                if (note.status === 'resolved') cms.outboxWritten();
                return note;
            }
            case 'remove': {
                const note = current(input.id);
                if (note.userId !== principal.id && !hasPermission(principal, PERMISSIONS.manageUsers)) throw new CmsError('CMS_FORBIDDEN', 'Only its author or an administrator removes a note.');
                await cms.notes.remove(note.id);
                const ids = [note.id, ...this.notes.filter(entry => entry.parentId === note.id).map(entry => entry.id)];
                this.notes = this.notes.filter(entry => !ids.includes(entry.id));
                tell({ kind: 'removed', ids });
                return null;
            }
            case 'move': {
                // Only threads on a passage of this entry move, and only their roots carry a range.
                const moves = input.moves.filter(move => { const note = this.notes.find(entry => entry.id === move.id); return !!note && !note.parentId && note.target.startsWith('text:'); });
                if (!moves.length) return null;
                await cms.notes.move(moves);
                this.notes = this.notes.map(entry => { const move = moves.find(candidate => candidate.id === entry.id); return move ? { ...entry, range: move.range } : entry; });
                tell({ kind: 'moved', moves: moves.map(move => ({ id: move.id, range: move.range })) });
                return null;
            }
        }
    }

    @Server()
    async leave(peer: unknown): Promise<void> {
        const { principal } = this.contextOf();
        const own = this.ownPeer(peer, principal);
        if (!own) return;
        const present = this.roomPeers.delete(own);
        this.releasePeer(own);
        if (!present) return;
        this.presenceChanged();
        this.broadcastEvent('left', own);
        void this.reportEditors();
    }

    @Server()
    async saved(peer: unknown): Promise<RoomSnapshot> {
        const { cms, principal } = this.contextOf();
        await this.load(cms);
        const resets: string[] = [];
        const snapshot = await this.restart(cms, resets);
        const user = await cms.users.get(principal.id).catch(() => null);
        this.broadcastEvent('saved', user?.name || principal.id, snapshot.rev, snapshot, resets, this.ownPeer(peer, principal) ?? '');
        return snapshot;
    }

    @Server()
    async reload(): Promise<RoomSnapshot> {
        const { cms } = this.contextOf();
        await this.load(cms);
        const resets: string[] = [];
        const snapshot = await this.restart(cms, resets);
        this.broadcastEvent('reloaded', snapshot, resets);
        return snapshot;
    }

    // --- Browser: this tab in the room ---------------------------------------------------------
    // The renderer assigns a child's props onto the instance, so no method below may share a name
    // with a prop (`onSet`, `onSaved`…): the event dispatch would call the page's callback instead.
    private peerId = '';
    private joined = false;
    private wasOpen = false;
    private current: PeerPresence = {};
    private peers = new Map<string, PeerState>();
    private heartbeat: ReturnType<typeof setInterval> | undefined;
    private joining: Promise<void> | undefined;

    onMount() {
        this.peerId = crypto.randomUUID();
        void this.enter(0);
        this.heartbeat = setInterval(() => {
            if (!this.joined) return;
            void this.presence(this.peerId, this.current).catch(() => undefined);
            // Peers this tab has not heard from have gone, whether or not the room said so (a restarted instance never does).
            this.forget(expiredPeers(this.peers.values(), Date.now()));
        }, HEARTBEAT);
    }

    /** Peers heard from, stamped with this tab's clock: the room's `at` is on another. */
    @Client()
    private hear(peers: readonly PeerState[]): void {
        const now = Date.now();
        for (const peer of peers) this.peers.set(peer.peer, { ...peer, at: now });
        this.props.onPeers([...this.peers.values()], this.peerId);
    }

    @Client()
    private forget(ids: readonly string[]): void {
        let gone = false;
        for (const id of ids) if (this.peers.delete(id)) gone = true;
        if (gone) this.props.onPeers([...this.peers.values()], this.peerId);
    }

    onCleanup() {
        if (this.heartbeat) clearInterval(this.heartbeat);
        if (this.joined) void this.leave(this.peerId).catch(() => undefined);
    }

    @OnWindow('pagehide')
    @Client()
    goodbye() {
        if (this.joined) void this.leave(this.peerId).catch(() => undefined);
    }

    /** Join, trying again while the connection comes up; after a reconnect, join again for a fresh draft. */
    @Client()
    private enter(attempt: number): Promise<void> {
        return this.joining ??= (async () => {
            try {
                const snapshot = await this.join(this.peerId, this.current);
                const initial = !this.joined;
                this.joined = true;
                this.peers = new Map();
                this.hear(snapshot.peers);
                // The page gets the room once it is joined: calls before the connection opens would fail.
                if (initial) this.props.onReady(this.handle());
                this.props.onSnapshot(snapshot, { initial, resets: initial ? [] : Object.keys(snapshot.versions) });
                if (!initial) for (const path of Object.keys(snapshot.versions)) { const editor = collabEditors.get(path); if (editor?.collab && editor.collab.version !== snapshot.versions[path]) void editor.collab.reload(); }
                this.status();
            } catch {
                if (attempt < 20 && !this.isDestroyed()) setTimeout(() => { this.joining = undefined; void this.enter(attempt + 1); }, Math.min(5000, 250 * 2 ** attempt));
            } finally { this.joining = undefined; }
        })();
    }

    @Client()
    private isDestroyed(): boolean {
        return (this as unknown as { _phase?: string })._phase === 'Destroyed';
    }

    @Client()
    updated(changed: Map<string | number | symbol, unknown>) {
        super.updated(changed);
        const open = this.realtime.websocket.state === 'open';
        if (open && !this.wasOpen && this.joined) void this.enter(0);
        if (open !== this.wasOpen) { this.wasOpen = open; this.status(); }
        if (changed.has('dirty') || changed.has('diverged') || changed.has('oversized')) this.status();
    }

    @Client()
    private status(): void {
        this.props.onStatus({ connected: this.joined && this.realtime.websocket.state === 'open', dirty: this.dirty, diverged: this.diverged, oversized: this.oversized });
    }

    @Client()
    private handle(): RoomHandle {
        const room = this;
        return {
            peer: this.peerId,
            set: (field, value) => room.set(room.peerId, field, value),
            tree: op => room.tree(room.peerId, op),
            blocks: field => room.blocks(field),
            transport: path => ({
                steps: (version, steps, clientID) => room.steps(room.peerId, path, version, steps, clientID),
                document: () => room.richText(path),
            }),
            fresh: () => room.draft(),
            presence: state => {
                room.current = { ...room.current, ...state };
                if (room.joined) void room.presence(room.peerId, room.current).catch(() => undefined);
            },
            saved: async () => { await room.saved(room.peerId); },
            reload: async () => { await room.reload(); },
            note: action => room.note(room.peerId, action),
        };
    }

    @OnEvent('set')
    private receiveSet(peer: string, field: string, value: unknown) {
        this.props.onSet(peer, field, value);
    }

    @OnEvent('tree')
    private receiveTree(peer: string, op: TreeOp, hash: string) {
        this.props.onTree(peer, op, hash);
    }

    @OnEvent('steps')
    private receiveSteps(path: string, steps: unknown[], clientIDs: (string | number)[], version: number) {
        collabEditors.get(path)?.collab?.receive(version, steps, clientIDs);
    }

    @OnEvent('presence')
    private receivePresence(peer: PeerState) {
        this.hear([peer]);
    }

    @OnEvent('left')
    private receiveLeft(peer: string) {
        this.forget([peer]);
    }

    @OnEvent('note')
    private receiveNote(change: NoteChange) {
        this.props.onNote(change);
    }

    /** Someone saved: everyone takes the saved values; the others hear who it was (the saver's own tab said "Saved." already). */
    @OnEvent('saved')
    private receiveSaved(by: string, rev: number, snapshot: RoomSnapshot, resets: string[], peer: string) {
        this.props.onSnapshot(snapshot, { initial: false, resets });
        for (const path of resets) void collabEditors.get(path)?.collab?.reload();
        if (peer !== this.peerId) this.props.onSaved(by, rev);
    }

    @OnEvent('reloaded')
    private receiveReloaded(snapshot: RoomSnapshot, resets: string[]) {
        this.props.onSnapshot(snapshot, { initial: false, resets });
        for (const path of resets) void collabEditors.get(path)?.collab?.reload();
    }

    /** Everyone in the entry as an avatar stack, the viewer first; the page shows the rest. */
    render(): TemplateResult | null {
        const me = this.peers.get(this.peerId)?.user ?? '';
        const everyone = [...this.participants.filter(participant => participant.user === me), ...this.participants.filter(participant => participant.user !== me)];
        if (!everyone.length) return null;
        return html`<div class="flex items-center gap-2" data-room-participants=${everyone.length}>${avatarStack(everyone, { size: 16, max: 5, label: __('In this entry'), self: me })}</div>`;
    }
}
