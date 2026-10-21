import { Client, Cossack, Page, Server, State, type HeadValue } from '@cossackframework/core';
import { Badge, Button, Card, CardBody, Modal, toast } from '@cossackframework/ui';
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { findBlock, hasPermission, isCmsError, PERMISSIONS, updateBlock } from '@cossackframework/cms';
import { requireAny } from '../../../../../cms/guards';
import { notice, pageHeader } from '../../../../../cms/ui';
import { blockFilePreviews, blockOptions, findMedia } from '../../../../../cms/content';
import { blocksInput, controlValue, editorBlocks, editorInput, type BlockOption, type EditorBlock } from '../../../../../cms/editor';
import { blockFields, type MediaHooks, type MediaPreview } from '../../../../../cms/field-controls';
import { BlockTree } from '../../../../../cms/block-tree';
import { closedChooser, mediaChooser, uploadMedia, withFile, type MediaChooserState } from '../../../../../cms/media-chooser';

interface AreaRow { name: string; label: string; theme: string; active: boolean; revision: number; blocks: EditorBlock[]; changed: boolean }
/** The block being edited in the dialog. */
interface BlockDialog { area: string; id: string; values: Record<string, unknown>; errors: Record<string, string> }

/**
 * Widgets: the blocks of the themes' widget areas, such as a footer or a sidebar. The active
 * theme's areas come first. Each area saves on its own, with a revision check. Blocks hold
 * control values while edited, as the entry editor's do.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageAppearance)] })
export default class WidgetsPage extends Cossack {
    @State() areas: AreaRow[] = [];
    @State() options: BlockOption[] = [];
    @State() previews: Record<string, MediaPreview> = {};
    @State() dialog: BlockDialog | null = null;
    @State() chooser: MediaChooserState = closedChooser();
    @State() error = '';

    head(): HeadValue {
        return { title: __('Widgets') };
    }

    async init() {
        await this.load();
    }

    @Server()
    async load() {
        const cms = this.c.get('cms');
        const saved = await cms.areas.all();
        // Synced patterns belong in entries; widgets hold their own blocks.
        this.options = (await blockOptions(cms)).filter(option => option.name !== 'core/pattern');
        this.areas = (await cms.areaLocations()).map(area => {
            const stored = saved.get(area.name);
            return { ...area, revision: stored?.revision ?? 0, blocks: editorBlocks((stored?.blocks ?? []) as EditorBlock[], this.options), changed: false };
        });
        this.previews = await blockFilePreviews(cms, this.areas.flatMap(area => area.blocks));
    }

    @Server()
    async save(name: string) {
        const cms = this.c.get('cms');
        const area = this.areas.find(entry => entry.name === name);
        if (!area) return;
        this.error = '';
        const converted = blocksInput(area.blocks, new Map(this.options.map(option => [option.name, option])));
        if ('error' in converted) { this.error = converted.error; return; }
        try {
            const known = (await cms.areaLocations()).map(entry => entry.name);
            const saved = await cms.areas.save(name, converted.value, { principal: this.c.get('principal'), expectedRevision: area.revision, known });
            this.areas = this.areas.map(entry => entry.name === name ? { ...entry, revision: saved.revision, blocks: editorBlocks(saved.blocks as EditorBlock[], this.options), changed: false } : entry);
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The widgets could not be saved.');
        }
    }

    @Client()
    async submit(name: string) {
        await this.save(name);
        if (this.error) toast.error(this.error);
        else toast.success(__('Widgets saved.'));
    }

    @Client()
    private change(name: string, blocks: EditorBlock[]) {
        this.areas = this.areas.map(area => area.name === name ? { ...area, blocks, changed: true } : area);
    }

    private blocksOf(name: string): EditorBlock[] {
        return this.areas.find(area => area.name === name)?.blocks ?? [];
    }

    @Client()
    edit(name: string, id: string) {
        const block = findBlock(this.blocksOf(name), id);
        const option = this.options.find(entry => entry.name === block?.type);
        if (!block || !option) return;
        this.dialog = { area: name, id, errors: {}, values: Object.fromEntries(option.fields.map(field => [field.name, block.data[field.name] ?? controlValue(field, field.defaultValue)])) };
    }

    @Client()
    setValue(name: string, value: unknown) {
        if (this.dialog) this.dialog = { ...this.dialog, values: { ...this.dialog.values, [name]: value }, errors: { ...this.dialog.errors, [name]: '' } };
    }

    @Client()
    apply(event: Event) {
        event.preventDefault();
        const dialog = this.dialog;
        const block = dialog ? findBlock(this.blocksOf(dialog.area), dialog.id) : undefined;
        const option = this.options.find(entry => entry.name === block?.type);
        if (!dialog || !block || !option) return;
        const { input, errors } = editorInput(option.fields, dialog.values);
        for (const field of option.fields) if (field.required && (input[field.name] === undefined || input[field.name] === '' || input[field.name] === null)) errors[field.name] ??= __('is required.');
        if (Object.keys(errors).length) { this.dialog = { ...dialog, errors }; return; }
        this.change(dialog.area, updateBlock(this.blocksOf(dialog.area), dialog.id, entry => ({ ...entry, data: { ...dialog.values } })));
        this.dialog = null;
    }

    @Server()
    async searchMedia(search: string) {
        if (!hasPermission(this.c.get('principal'), PERMISSIONS.manageAppearance)) return;
        this.chooser = { ...this.chooser, search, items: await findMedia(this.c.get('cms'), search) };
    }

    @Client()
    async openChooser(field: string, multiple: boolean) {
        this.chooser = { ...this.chooser, open: true, field, multiple };
        await this.searchMedia(this.chooser.search);
    }

    @Client()
    choose(file: MediaPreview) {
        this.previews = { ...this.previews, [file.id]: file };
        this.setValue(this.chooser.field, withFile(this.dialog?.values[this.chooser.field], file.id, this.chooser.multiple));
        if (!this.chooser.multiple) this.chooser = { ...this.chooser, open: false };
    }

    @Client()
    async upload(event: Event) {
        const { files, error } = await uploadMedia(event.currentTarget as HTMLInputElement);
        if (error) toast.error(error);
        for (const file of files) this.choose(file);
        await this.searchMedia('');
    }

    private areaCard(area: AreaRow): TemplateResult {
        return component(Card, {}, component(CardBody, { class: 'space-y-4' }, html`
            <div class="flex flex-wrap items-center justify-between gap-2">
                <h2 class="text-base font-semibold text-foreground">${area.label}</h2>
                ${area.active ? null : component(Badge, { variant: 'secondary' }, `${__('Theme')}: ${area.theme}`)}
            </div>
            ${component(BlockTree, {
                id: `area-${area.name}`, blocks: area.blocks, options: this.options, allowed: [], inline: false, previews: this.previews,
                onChange: (blocks: EditorBlock[]) => this.change(area.name, blocks), onEdit: (id: string) => this.edit(area.name, id), control: () => null,
            })}
            <div class="flex justify-end">
                ${component(Button, { type: 'button', disabled: !area.changed, '@click': () => this.submit(area.name) }, __('Save widgets'))}
            </div>`));
    }

    private dialogModal(): TemplateResult {
        const dialog = this.dialog;
        const block = dialog ? findBlock(this.blocksOf(dialog.area), dialog.id) : undefined;
        const option = this.options.find(entry => entry.name === block?.type);
        const media = (field: string): MediaHooks => ({ previews: this.previews, choose: multiple => this.openChooser(field, multiple) });
        return component(Modal, { open: Boolean(dialog && option), size: 'max-w-xl', 'aria-label': option?.label ?? __('Block'), onOpenChange: (open: boolean) => { if (!open) this.dialog = null; } },
            dialog && option ? html`<form class="space-y-4" @submit=${(event: Event) => this.apply(event)}>
                <h2 class="text-lg font-semibold text-foreground">${option.label}</h2>
                ${blockFields(option, dialog.values, (name, value) => this.setValue(name, value), `widget-${dialog.area}-${dialog.id}`, media, dialog.errors)}
                <div class="flex justify-end gap-2">
                    ${component(Button, { type: 'button', variant: 'outline', '@click': () => { this.dialog = null; } }, __('Cancel'))}
                    ${component(Button, { type: 'submit' }, __('Apply'))}
                </div>
            </form>` : html``);
    }

    render() {
        return html`<div class="space-y-6">
            ${pageHeader(__('Widgets'), { description: __('Blocks the theme shows outside entries, such as in a footer or a sidebar. Areas of other themes keep their widgets for when you switch.') })}
            ${this.error ? notice(this.error, 'error') : null}
            ${this.areas.length ? html`<div class="grid gap-4 lg:grid-cols-2">${this.areas.map(area => this.areaCard(area))}</div>`
                : notice(__('The active theme has no widget areas.'))}
            ${this.dialogModal()}
            ${mediaChooser(this.chooser, {
                search: text => this.searchMedia(text), choose: file => this.choose(file), upload: event => this.upload(event),
                close: () => { this.chooser = { ...this.chooser, open: false }; },
            })}
        </div>`;
    }
}
