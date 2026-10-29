import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { AlertDialog, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, NativeSelect, Textarea, toast } from '@cossackframework/ui';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { CORE_FIELDS, isCmsError, PERMISSIONS, type Block, type FieldGroup, type FieldGroupTarget } from '@cossackframework/cms';
import { collectionName } from '../../../../../cms/builder';
import { blockOptions } from '../../../../../cms/content';
import { blocksInput, editorBlocks, type BlockOption, type EditorBlock } from '../../../../../cms/editor';
import { FieldGroupEditor } from '../../../../../cms/field-group-editor';
import { describeBlockError } from '../../../../../cms/block-errors';
import { requireAny } from '../../../../../cms/guards';
import { notice, pageHeader } from '../../../../../cms/ui';

interface Draft { id: string; title: string; description: string; placement: 'main' | 'sidebar'; order: string }
interface TargetChoice { kind: FieldGroupTarget['kind']; name: string; label: string }

/**
 * Edit a field group, or make one at `/new`: its title, where its box shows, the targets it
 * is attached to, and its fields laid out in the block tree, all in one step. Saving plans
 * the targets' indexes; entries keep values of fields that are removed.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageCollections)] })
export default class FieldGroupPage extends Cossack {
    @State() draft: Draft | null = null;
    @State() targets: FieldGroupTarget[] = [];
    @State() choices: TargetChoice[] = [];
    @State() blocks: EditorBlock[] = [];
    @State() options: BlockOption[] = [];
    @State() message = '';
    @State() error = '';
    @State() confirmDelete = false;

    /** True until the group is saved for the first time. */
    @State() fresh = false;

    head(): HeadValue {
        return { title: this.fresh ? __('New field group') : this.draft ? `${this.draft.title} — ${__('Field group')}` : __('Field group') };
    }

    async init() {
        await this.load(this.c.req.param('id') ?? 'new');
        if (this.c.req.query('created') === '1') this.message = __('Field group created.');
    }

    @Server()
    async load(id: string) {
        const cms = this.c.get('cms');
        this.fresh = id === 'new';
        // A new group starts empty, attached to the collection the collection manager came from.
        const collection = this.fresh ? this.c.req.query('collection') ?? '' : '';
        const group = this.fresh
            ? { id: '', title: '', description: '', placement: 'main' as const, order: undefined, blocks: [] as Block[],
                targets: collection && cms.collections().some(entry => entry.name === collection && !entry.managed) ? [{ kind: 'collection' as const, name: collection }] : [] }
            : await cms.fieldGroups.get(id);
        if (!group) { this.error = __('This field group does not exist.'); this.c.status(404); return; }
        this.draft = { id: group.id, title: group.title, description: group.description ?? '', placement: group.placement ?? 'main', order: group.order === undefined ? '' : String(group.order) };
        this.targets = [...group.targets];
        this.choices = [
            ...cms.collections().filter(collection => !collection.managed).map(collection => ({ kind: 'collection' as const, name: collection.name, label: collection.label })),
            ...cms.taxonomies.declarations.map(taxonomy => ({ kind: 'taxonomy' as const, name: taxonomy.name, label: taxonomy.label })),
            { kind: 'users', name: '', label: __('Users') }, { kind: 'menus', name: '', label: __('Menu items') },
        ];
        this.options = await blockOptions(cms);
        this.blocks = editorBlocks(group.blocks as EditorBlock[], this.options);
    }

    @Client()
    setDraft<K extends keyof Draft>(key: K, value: Draft[K]) {
        if (this.draft) this.draft = { ...this.draft, [key]: value };
    }

    @Client()
    toggleTarget(choice: TargetChoice, checked: boolean) {
        const target: FieldGroupTarget = choice.kind === 'collection' || choice.kind === 'taxonomy' ? { kind: choice.kind, name: choice.name } : { kind: choice.kind };
        const same = (entry: FieldGroupTarget) => entry.kind === target.kind && ('name' in entry ? entry.name : '') === choice.name;
        // A target already there keeps its place among the target's boxes.
        if (checked && this.targets.some(same)) return;
        this.targets = checked ? [...this.targets, target] : this.targets.filter(entry => !same(entry));
    }

    @Client()
    private changeBlocks(blocks: EditorBlock[]) {
        this.blocks = blocks;
    }

    @Client()
    async submit() {
        if (!this.draft) return;
        await this.save(this.draft, this.targets, this.blocks);
        if (this.error) toast.error(this.error); else if (!this.fresh) toast.success(__('Field group saved.'));
    }

    @Server()
    async save(draft: Draft, targets: FieldGroupTarget[], blocks: EditorBlock[]) {
        this.error = '';
        this.message = '';
        const options = await blockOptions(this.c.get('cms'));
        const converted = blocksInput(blocks, new Map(options.map(option => [option.name, option])));
        if ('error' in converted) { this.error = `${__('Fields')}: ${converted.error}`; return; }
        const order = draft.order.trim() === '' ? undefined : Number(draft.order);
        // A new group's ID comes from its title.
        const id = draft.id || collectionName(draft.title).replaceAll('_', '-');
        if (!id) { this.error = __('Give the field group a title.'); return; }
        const group: FieldGroup = {
            id, title: draft.title.trim(), description: draft.description.trim(), placement: draft.placement,
            ...(order !== undefined && Number.isSafeInteger(order) ? { order } : {}), targets, blocks: converted.value as Block[],
        };
        try {
            const saved = await this.c.get('cms').saveFieldGroup(group, this.c.get('principal'));
            if (this.fresh) return this.redirect(`/dashboard/field-groups/${saved.id}?created=1`);
            await this.load(saved.id);
            this.message = __('Field group saved.');
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The field group could not be saved.');
        }
    }

    @Server()
    async remove() {
        try {
            await this.c.get('cms').deleteFieldGroup(this.c.req.param('id') ?? '', this.c.get('principal'));
            return this.redirect('/dashboard/field-groups');
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The field group could not be deleted.');
        }
    }

    private check(choice: TargetChoice): TemplateResult {
        const checked = this.targets.some(entry => entry.kind === choice.kind && ('name' in entry ? entry.name : '') === choice.name);
        return html`<label class="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            ${component(Checkbox, { checked, '@change': (event: Event) => this.toggleTarget(choice, (event.target as HTMLInputElement).checked) })} ${choice.label}
        </label>`;
    }

    render() {
        const draft = this.draft;
        if (!draft) return notice(this.error || __('This field group does not exist.'), 'error');
        // Conditions may test what every target has: an entry's core fields are the common ground.
        const scope = CORE_FIELDS.map(name => ({ name, label: name }));
        return html`<div class="space-y-6">
            ${pageHeader(this.fresh ? __('New field group') : draft.title, {
                description: this.fresh ? __('A box of fields for editors. Lay its fields out and choose where it shows.') : `${__('Field group')} ${draft.id}`,
                actions: html`<a href="/dashboard/field-groups" class="text-sm text-muted-foreground hover:text-foreground">← ${__('Field groups')}</a>
                    ${component(Button, { type: 'button', disabled: this.fresh && !collectionName(draft.title), '@click': () => this.submit() }, this.fresh ? __('Create field group') : __('Save field group'))}`,
            })}
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error ? notice(describeBlockError(this.error, this.blocks, this.options), 'error') : null}
            <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
                ${component(Card, {}, html`
                    ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Fields')}</h2>
                        <p class="text-sm text-muted-foreground">${__('Field blocks between columns, tabs, headings and notes, as the box should show them. A repeater holds rows of fields. Conditional logic shows a field on the values of the others.')}</p>`)}
                    ${component(CardBody, {}, component(FieldGroupEditor, { id: 'group', blocks: this.blocks, options: this.options, scope, error: this.error, onChange: (blocks: EditorBlock[]) => this.changeBlocks(blocks) }))}
                `)}
                <aside class="space-y-6">
                    ${component(Card, {}, component(CardBody, { class: 'space-y-4' }, html`
                        <h2 class="text-base font-semibold text-foreground">${__('Settings')}</h2>
                        ${component(Field, { label: __('Title'), for: 'group-title', ...(this.fresh ? { hint: draft.title ? `${__('Stored as')} ${collectionName(draft.title).replaceAll('_', '-') || '…'}` : __('Such as Product details.') } : {}),
                            control: attributes => component(Input, { ...attributes, '.value': draft.title, '@input': (event: Event) => this.setDraft('title', (event.target as HTMLInputElement).value) }) })}
                        ${component(Field, { label: __('Description'), for: 'group-description', hint: __('Shown under the box\'s title.'),
                            control: attributes => component(Textarea, { ...attributes, rows: 2, '.value': draft.description, '@input': (event: Event) => this.setDraft('description', (event.target as HTMLTextAreaElement).value) }) })}
                        ${component(Field, { label: __('Placement'), for: 'group-placement', hint: __('In entry editors; terms, users and menu items have one column.'),
                            control: attributes => component(NativeSelect, { ...attributes, '@change': (event: Event) => this.setDraft('placement', (event.target as HTMLSelectElement).value as Draft['placement']) }, html`
                                <option value="main" ?selected=${draft.placement === 'main'}>${__('Main column')}</option>
                                <option value="sidebar" ?selected=${draft.placement === 'sidebar'}>${__('Sidebar')}</option>`) })}
                        ${component(Field, { label: __('Order'), for: 'group-order', hint: __('Boxes of one place show in ascending order.'),
                            control: attributes => component(Input, { ...attributes, type: 'number', '.value': draft.order, '@input': (event: Event) => this.setDraft('order', (event.target as HTMLInputElement).value) }) })}
                    `))}
                    ${component(Card, {}, component(CardBody, { class: 'space-y-3' }, html`
                        <h2 class="text-base font-semibold text-foreground">${__('Shown on')}</h2>
                        ${this.choices.map(choice => this.check(choice))}
                    `))}
                    ${this.fresh ? null : component(Card, {}, component(CardBody, { class: 'space-y-3' }, html`
                        <h2 class="text-base font-semibold text-destructive">${__('Delete field group')}</h2>
                        <p class="text-sm text-muted-foreground">${__('The box disappears from its editors. Values already stored stay in their entries until those are saved without them.')}</p>
                        ${component(Button, { type: 'button', variant: 'destructive', size: 'sm', '@click': () => { this.confirmDelete = true; } }, __('Delete field group'))}
                    `))}
                </aside>
            </div>
            ${component(AlertDialog, {
                id: 'delete-group-dialog', open: this.confirmDelete, title: `${__('Delete')} ${draft.title}?`,
                description: __('The field group is removed from every editor it shows in. This cannot be undone.'),
                cancelLabel: __('Cancel'), actionLabel: __('Delete'), actionVariant: 'destructive',
                onAction: () => { this.confirmDelete = false; void this.remove(); }, onOpenChange: () => { this.confirmDelete = false; },
            })}
        </div>`;
    }
}
