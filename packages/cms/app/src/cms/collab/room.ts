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
    applyTreeOp, checkPresence, findBlock, groupPeers, livePeers, parseRichTextPath, participantColor, richTextProblem, stableJson, StepLog, systemPrincipal, treeHash, updateBlock,
    type Block, type Participant, type PeerPresence, type PeerState, type Principal, type RichTextDoc, type TreeOp,
} from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';
import { editorView, entryValues, routeResource } from '../content';
import type { EditorValues, EditorView } from '../editor';
import { collabEditors } from '../rich-text-field';
import type { CollabTransport, StepsResult } from '../rich-text.client';
import { richTextSchema } from '../rich-text-schema';
import { avatarStack } from './presence';

const PEER = /^[A-Za-z0-9_-]{8,64}$/;
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
/** The entries an editor's access was checked for, by user and entry: a guard runs for every frame to every peer. */
const RECENT_ACCESS = new Map<string, number>();
const ACCESS_TTL = 5000;

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
    if ((RECENT_ACCESS.get(key) ?? 0) <= now) {
        let allowed = false;
        try {
            const { resource } = routeResource(cms, route);
            const repository = cms.resource(resource.id);
            const record = await repository.get(id, { principal });
            allowed = record !== null && repository.canUpdate(record, principal);
        } catch { allowed = false; }
        if (!allowed) return forbidden(c);
        if (RECENT_ACCESS.size >= 1000) for (const [entry, until] of RECENT_ACCESS) if (until <= now) RECENT_ACCESS.delete(entry);
        RECENT_ACCESS.set(key, now + ACCESS_TTL);
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
}

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
    /** Rich text keys by block type. */
    private richKeys = new Map<string, Set<string>>();
    private docs = new Map<string, ProseMirrorNode>();
    private logs = new Map<string, StepLog>();
    private roomPeers = new Map<string, PeerState>();
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
            // A multiple rich text field is a list of documents: it travels as one value, like a scalar.
            for (const field of view.fields) {
                if (field.kind === 'blocks') this.blockFields.add(field.name);
                else if (field.kind === 'richtext' && !field.multiple) this.richFields.add(field.name);
            }
            for (const option of view.blocks) {
                const keys = option.fields.filter(field => field.kind === 'richtext').map(field => field.name);
                if (keys.length) this.richKeys.set(option.name, new Set(keys));
            }
            const values = await entryValues(cms, view, record);
            for (const name of Object.keys(values)) if (!this.blockFields.has(name) && !this.richFields.has(name)) this.scalarFields.add(name);
            this.rev = record.rev;
            this.baseRev = record.rev;
            const draft = await cms.drafts.get(resource.id, id).catch(() => null);
            if (draft && draft.at > record.updatedAt && draft.baseRev === record.rev && Object.keys(draft.values).length) {
                this.values = { ...values, ...draft.values };
                for (const [path, version] of Object.entries(draft.versions)) if (Number.isSafeInteger(version) && version >= 0) this.logs.set(path, new StepLog(version));
                this.dirty = true;
            } else this.values = values;
        })().catch(error => { this.entryLoading = undefined; throw error; });
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
        return { values: this.values, versions: this.versions(), hashes: this.hashes(), rev: this.rev, peers: [...this.roomPeers.values()] };
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

    /** Peers that fell silent leave; the participants follow; the draft row names who is here. */
    private presenceChanged(): void {
        const now = Date.now();
        for (const [id, peer] of this.roomPeers) if (now - peer.at >= EDITORS_EVERY) this.roomPeers.delete(id);
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
        const values = await entryValues(cms, this.view!, record);
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

    @Server()
    async join(peer: unknown, presence: unknown): Promise<RoomSnapshot> {
        const { cms, principal } = this.contextOf();
        await this.load(cms);
        if (typeof peer !== 'string' || !PEER.test(peer)) throw new Error('Invalid peer.');
        const user = await cms.users.get(principal.id).catch(() => null);
        const state: PeerState = { peer, user: principal.id, name: user?.name || user?.email || principal.id, avatar: user?.avatar ?? null, color: participantColor(principal.id), at: Date.now(), presence: checkPresence(presence) };
        this.roomPeers.set(peer, state);
        this.presenceChanged();
        this.broadcastEvent('presence', state);
        void this.reportEditors();
        await this.checkDivergence(cms);
        return this.snapshot();
    }

    @Server()
    async set(peer: unknown, field: unknown, value: unknown): Promise<{ applied: boolean }> {
        const { cms } = this.contextOf();
        await this.load(cms);
        if (typeof peer !== 'string' || !PEER.test(peer) || typeof field !== 'string' || !this.scalarFields.has(field) || stableJson(value).length > VALUE_MAX) return { applied: false };
        this.values = { ...this.values, [field]: value };
        this.changed();
        this.broadcastEvent('set', peer, field, value);
        return { applied: true };
    }

    @Server()
    async tree(peer: unknown, op: unknown): Promise<{ applied: boolean; hash: string }> {
        const { cms } = this.contextOf();
        await this.load(cms);
        const checked = typeof peer === 'string' && PEER.test(peer) ? this.checkOp(op) : null;
        const field = checked?.field ?? '';
        const current = (this.values[field] as Block[] | undefined) ?? [];
        if (!checked) return { applied: false, hash: treeHash(current) };
        const next = applyTreeOp(current, checked);
        if (!next) return { applied: false, hash: treeHash(current) };
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
        const { cms } = this.contextOf();
        await this.load(cms);
        const at = typeof path === 'string' ? this.richTextAt(path) : null;
        if (!at || typeof peer !== 'string' || !PEER.test(peer) || typeof clientID !== 'string' || clientID.length > 64 || !Number.isSafeInteger(version) || !Array.isArray(steps) || steps.length > STEPS_MAX) return { status: 'reload' };
        const log = this.logAt(path as string);
        if (!log.accepts(version as number)) {
            const since = log.since(version as number);
            return since ? { status: 'behind', ...since } : { status: 'reload' };
        }
        if (!steps.length) return { status: 'accepted', version: log.version };
        let doc = this.docAt(path as string, at);
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
        if (problem) return { status: 'reload' };
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
        const { cms } = this.contextOf();
        await this.load(cms);
        const at = typeof path === 'string' ? this.richTextAt(path) : null;
        if (!at) return { doc: null, version: 0 };
        return { doc: JSON.parse(JSON.stringify(this.docAt(path as string, at).toJSON())) as RichTextDoc, version: this.logAt(path as string).version };
    }

    @Server()
    async presence(peer: unknown, state: unknown): Promise<void> {
        const { cms, principal } = this.contextOf();
        await this.load(cms);
        if (typeof peer !== 'string' || !PEER.test(peer)) return;
        const known = this.roomPeers.get(peer);
        const next: PeerState = known
            ? { ...known, at: Date.now(), presence: checkPresence(state) }
            : { peer, user: principal.id, name: principal.id, avatar: null, color: participantColor(principal.id), at: Date.now(), presence: checkPresence(state) };
        this.roomPeers.set(peer, next);
        this.presenceChanged();
        this.broadcastEvent('presence', next);
    }

    @Server()
    async leave(peer: unknown): Promise<void> {
        if (typeof peer !== 'string' || !this.roomPeers.delete(peer)) return;
        this.presenceChanged();
        this.broadcastEvent('left', peer);
        void this.reportEditors();
    }

    @Server()
    async saved(peer: unknown): Promise<RoomSnapshot> {
        const { cms, principal } = this.contextOf();
        await this.load(cms);
        const resets: string[] = [];
        const snapshot = await this.restart(cms, resets);
        const user = await cms.users.get(principal.id).catch(() => null);
        this.broadcastEvent('saved', user?.name || principal.id, snapshot.rev, snapshot, resets, typeof peer === 'string' ? peer : '');
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
        this.heartbeat = setInterval(() => { if (this.joined) void this.presence(this.peerId, this.current).catch(() => undefined); }, HEARTBEAT);
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
                this.peers = new Map(snapshot.peers.map(peer => [peer.peer, peer]));
                this.props.onPeers([...this.peers.values()], this.peerId);
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
        this.peers.set(peer.peer, peer);
        this.props.onPeers([...this.peers.values()], this.peerId);
    }

    @OnEvent('left')
    private receiveLeft(peer: string) {
        if (this.peers.delete(peer)) this.props.onPeers([...this.peers.values()], this.peerId);
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

    /** Who else is here, as an avatar stack; the page shows the rest. */
    render(): TemplateResult | null {
        const me = this.peers.get(this.peerId)?.user;
        const others = this.participants.filter(participant => participant.user !== me);
        if (!others.length) return null;
        return html`<div class="flex items-center gap-2" data-room-participants=${others.length}>${avatarStack(others, { size: 28, max: 5, label: __('Also editing') })}</div>`;
    }
}
