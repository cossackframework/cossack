/**
 * The Notes rail of the entry editor: a sheet at the side listing the entry's review threads,
 * open or resolved, each with where it sits (a field, a block, a quoted passage), its messages
 * and a reply box; and the small markers the fields, blocks and passages carry. Everything here
 * is drawn from props; the editor page owns the state and talks to the entry's room. Client-safe.
 */
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { Button, Combobox, Icon, Textarea } from '@cossackframework/ui';
import { mentionToken, noteParts, type Note, type NoteRange, type NoteStatus, type NoteThread } from '@cossackframework/cms';
import { avatar, type Someone } from './collab/presence';
import { icon } from './icons';
import { iconButton, shortDate } from './ui';

/** A note being written: where it goes and the text so far. A reply names its thread. */
export interface NoteComposer {
    target: string;
    range: NoteRange | null;
    quote: string;
    parentId: string | null;
    body: string;
}

/** Where a thread sits, in words: the field or block, and the passage it quotes. */
export interface NoteAnchorView {
    label: string;
    quote: string;
    /** The passage is gone: the note shows on its block or field instead. */
    detached: boolean;
}

export interface NotesRailProps {
    /** Page-unique prefix for element IDs. */
    id: string;
    open: boolean;
    threads: readonly NoteThread[];
    filter: NoteStatus;
    /** Who the notes name, by user ID. */
    people: Record<string, Someone>;
    /** The viewer's user ID: their own notes can be changed and removed. */
    me: string;
    /** The viewer removes anyone's notes. */
    admin: boolean;
    /** The thread chosen, highlighted here and in the content. */
    active: string | null;
    composer: NoteComposer | null;
    /** A note whose text is being changed. */
    editing: { id: string; body: string } | null;
    mentionable: readonly { id: string; name: string }[];
    busy: boolean;
    error: string;
    anchor(root: Note): NoteAnchorView;
    onClose(): void;
    onFilter(filter: NoteStatus): void;
    onSelect(id: string): void;
    onCompose(composer: NoteComposer | null): void;
    onSubmit(): void;
    onEdit(editing: { id: string; body: string } | null): void;
    onSaveEdit(): void;
    onResolve(id: string): void;
    onReopen(id: string): void;
    onRemove(id: string): void;
}

const AMBER = 'rounded-full border border-amber-500/60 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-amber-700 dark:text-amber-300';

/** The count of open notes on a field, block or the entry: an amber chip that opens them. */
export function noteMarker(count: number, label: string, onClick: () => void): TemplateResult | null {
    if (!count) return null;
    return html`<button type="button" class=${`inline-flex items-center gap-1 ${AMBER} cursor-pointer hover:bg-amber-500/20`} data-notes=${count} aria-label=${`${count} ${count === 1 ? __('open note on') : __('open notes on')} ${label}`} title=${__('Show the notes')}
        @click=${(event: Event) => { event.stopPropagation(); onClick(); }}>${component(Icon, { entry: icon('notes'), size: 12 })}${count}</button>`;
}

/** The button that starts a note on a field or block; shown when its row is hovered or focused. */
export function noteButton(id: string, label: string, onClick: () => void, options: { always?: boolean } = {}): TemplateResult {
    return html`<button type="button" id=${id} class=${`inline-flex size-6 items-center justify-center rounded border-none bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer [&_svg]:size-3.5 ${options.always ? '' : 'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100'}`}
        aria-label=${`${__('Add a note on')} ${label}`} title=${__('Add a note')} @click=${(event: Event) => { event.stopPropagation(); onClick(); }}>${component(Icon, { entry: icon('chat-round-line'), size: 14 })}</button>`;
}

/** A note's text with its mentions shown as names. */
export function noteBody(body: string): TemplateResult {
    return html`<p class="whitespace-pre-wrap break-words text-sm text-foreground">${noteParts(body).map(part => part.kind === 'mention'
        ? html`<span class="rounded bg-primary/10 px-1 font-medium text-primary" data-mention=${part.user}>@${part.name}</span>`
        : part.text)}</p>`;
}

/** The composer's mention picker: a chosen person becomes a token at the end of the text. */
function mentionPicker(id: string, props: NotesRailProps, body: string, change: (body: string) => void): TemplateResult | null {
    if (!props.mentionable.length) return null;
    return component(Combobox, {
        id, options: props.mentionable.map(person => ({ value: person.id, label: person.name })), value: '', placeholder: __('Mention someone…'), emptyLabel: __('Nobody matches.'), 'aria-label': __('Mention someone'),
        onValueChange: (value: string) => {
            const person = props.mentionable.find(entry => entry.id === value);
            if (person) change(`${body}${body && !/\s$/.test(body) ? ' ' : ''}${mentionToken(person)} `);
        },
    });
}

/** The box a note or a reply is written in. */
function composerView(props: NotesRailProps, composer: NoteComposer, title: string): TemplateResult {
    const id = `${props.id}-composer`;
    return html`<form class="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/5 p-3" data-note-composer=${composer.parentId ?? 'new'} @submit=${(event: Event) => { event.preventDefault(); props.onSubmit(); }}>
        <p class="text-xs font-medium text-foreground">${title}</p>
        ${composer.quote ? html`<blockquote class="border-l-2 border-amber-500 pl-2 text-xs italic text-muted-foreground">${composer.quote}</blockquote>` : null}
        ${component(Textarea, { id, rows: 3, placeholder: __('Write a note…'), autofocus: true, 'aria-label': __('Note'), '.value': composer.body, '@input': (event: Event) => props.onCompose({ ...composer, body: (event.target as HTMLTextAreaElement).value }) })}
        <div class="flex flex-wrap items-center gap-2">
            ${mentionPicker(`${id}-mention`, props, composer.body, body => props.onCompose({ ...composer, body }))}
            <span class="flex-1"></span>
            ${component(Button, { type: 'button', variant: 'ghost', size: 'sm', '@click': () => props.onCompose(null) }, __('Cancel'))}
            ${component(Button, { type: 'submit', size: 'sm', disabled: props.busy || !composer.body.trim() }, composer.parentId ? __('Reply') : __('Post note'))}
        </div>
    </form>`;
}

/** One message of a thread: who, when, the text; its author's edit and remove on hover. */
function messageView(props: NotesRailProps, note: Note, root: Note): TemplateResult {
    const person = props.people[note.userId] ?? { user: note.userId, name: note.userId, avatar: null, color: 'var(--muted-foreground)' };
    const mine = note.userId === props.me;
    const editing = props.editing?.id === note.id ? props.editing : null;
    return html`<div class="group/note flex gap-2" data-note=${note.id}>
        <span class="mt-0.5 shrink-0">${avatar(person, 20)}</span>
        <div class="min-w-0 flex-1 space-y-1">
            <p class="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span class="font-medium text-foreground">${person.name}</span>
                <span class="text-muted-foreground">${shortDate(note.createdAt)}${note.updatedAt > note.createdAt && note.parentId ? ` · ${__('edited')}` : ''}</span>
                <span class="ml-auto inline-flex gap-1 opacity-0 transition-opacity group-hover/note:opacity-100 group-focus-within/note:opacity-100">
                    ${mine && !editing ? iconButton(`${props.id}-change-${note.id}`, 'pen', __('Edit'), () => props.onEdit({ id: note.id, body: note.body })) : null}
                    ${mine || props.admin ? iconButton(`${props.id}-remove-${note.id}`, 'trash-bin-trash', note.parentId ? __('Remove') : __('Remove thread'), () => props.onRemove(note.id), { danger: true }) : null}
                </span>
            </p>
            ${editing ? html`<form class="space-y-2" @submit=${(event: Event) => { event.preventDefault(); props.onSaveEdit(); }}>
                ${component(Textarea, { id: `${props.id}-edit-${note.id}`, rows: 3, autofocus: true, 'aria-label': __('Note'), '.value': editing.body, '@input': (event: Event) => props.onEdit({ id: note.id, body: (event.target as HTMLTextAreaElement).value }) })}
                <div class="flex items-center justify-end gap-2">
                    ${component(Button, { type: 'button', variant: 'ghost', size: 'sm', '@click': () => props.onEdit(null) }, __('Cancel'))}
                    ${component(Button, { type: 'submit', size: 'sm', disabled: props.busy || !editing.body.trim() }, __('Save'))}
                </div>
            </form>` : noteBody(note.body)}
            ${!note.parentId && root.status === 'resolved' && root.resolvedBy ? html`<p class="text-xs text-muted-foreground">${__('Resolved by')} ${props.people[root.resolvedBy]?.name ?? root.resolvedBy}${root.resolvedAt ? ` · ${shortDate(root.resolvedAt)}` : ''}</p>` : null}
        </div>
    </div>`;
}

function threadView(props: NotesRailProps, thread: NoteThread): TemplateResult {
    const { root } = thread;
    const where = props.anchor(root);
    const active = props.active === root.id;
    const replying = props.composer?.parentId === root.id ? props.composer : null;
    return html`<article class=${`space-y-3 rounded-lg border bg-card p-3 ${active ? 'border-amber-500 ring-2 ring-amber-500/30' : 'border-border'}`} data-note-thread=${root.id} data-status=${root.status}>
        <button type="button" class="flex w-full items-start gap-2 border-none bg-transparent p-0 text-left cursor-pointer" @click=${() => props.onSelect(root.id)} aria-label=${`${__('Show in the entry')}: ${where.label}`}>
            <span class="inline-flex shrink-0 text-amber-600 [&_svg]:size-4"><span class="inline-flex">${component(Icon, { entry: icon(where.detached ? 'pin' : 'notes'), size: 16 })}</span></span>
            <span class="min-w-0 flex-1">
                <span class="block text-xs font-medium text-foreground">${where.label}${where.detached ? html` <span class="font-normal text-muted-foreground">(${__('the text changed')})</span>` : null}</span>
                ${where.quote ? html`<span class="block truncate text-xs italic text-muted-foreground">“${where.quote}”</span>` : null}
            </span>
        </button>
        ${messageView(props, root, root)}
        ${thread.replies.length ? html`<div class="space-y-3 border-l-2 border-border pl-3">${thread.replies.map(reply => messageView(props, reply, root))}</div>` : null}
        ${replying ? composerView(props, replying, __('Reply')) : html`<div class="flex flex-wrap items-center gap-2">
            ${root.status === 'open' ? html`${component(Button, { type: 'button', size: 'sm', variant: 'outline', '@click': () => props.onCompose({ target: root.target, range: null, quote: '', parentId: root.id, body: '' }) }, __('Reply'))}
                ${component(Button, { type: 'button', size: 'sm', variant: 'ghost', disabled: props.busy, '@click': () => props.onResolve(root.id) }, __('Resolve'))}`
                : component(Button, { type: 'button', size: 'sm', variant: 'outline', disabled: props.busy, '@click': () => props.onReopen(root.id) }, __('Reopen'))}
        </div>`}
    </article>`;
}

/**
 * The rail itself: a panel fixed at the right, not a modal, so the entry stays editable while
 * the notes are read; it leaves the dashboard's taskbar visible. Escape inside it closes it.
 */
export function notesRail(props: NotesRailProps): TemplateResult | null {
    if (!props.open) return null;
    const open = props.threads.filter(thread => thread.root.status === 'open');
    const resolved = props.threads.filter(thread => thread.root.status === 'resolved');
    const shown = props.filter === 'open' ? open : resolved;
    const tab = (filter: NoteStatus, label: string, count: number) => html`<button type="button" role="tab" aria-selected=${props.filter === filter ? 'true' : 'false'}
        class=${`rounded-md px-2.5 py-1 text-xs font-medium border-none cursor-pointer ${props.filter === filter ? 'bg-muted text-foreground' : 'bg-transparent text-muted-foreground hover:text-foreground'}`}
        @click=${() => props.onFilter(filter)}>${label} <span class="text-muted-foreground">${count}</span></button>`;
    return html`<aside id=${`${props.id}-rail`} role="complementary" aria-label=${__('Notes')} data-notes-rail
        class="fixed inset-y-0 right-0 z-40 w-[26rem] max-w-[calc(100vw-1rem)] border-l border-border bg-background text-foreground shadow-xl md:bottom-10"
        @keydown=${(event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); props.onClose(); } }}>
        <div class="flex h-full flex-col">
            <header class="flex items-center gap-3 border-b border-border px-5 py-4">
                <h2 class="text-base font-semibold text-foreground">${__('Notes')}</h2>
                <div role="tablist" class="flex items-center gap-1">${tab('open', __('Open'), open.length)}${tab('resolved', __('Resolved'), resolved.length)}</div>
                <span class="flex-1"></span>
                <button type="button" class="inline-flex size-8 shrink-0 items-center justify-center rounded-md border-none bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer" aria-label=${__('Close')} @click=${() => props.onClose()}>✕</button>
            </header>
            <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
                ${props.error ? html`<p role="alert" class="text-sm text-destructive">${props.error}</p>` : null}
                ${props.composer && !props.composer.parentId ? composerView(props, props.composer, `${__('New note on')} ${props.anchor({ target: props.composer.target } as Note).label}`) : null}
                ${shown.length ? shown.map(thread => threadView(props, thread))
                    : html`<p class="text-sm text-muted-foreground">${props.filter === 'open'
                        ? __('No open notes. Hover a field or a block and choose “Add a note”, or select text and use Note in the toolbar.')
                        : __('Nothing resolved yet.')}</p>`}
            </div>
        </div>
    </aside>`;
}
