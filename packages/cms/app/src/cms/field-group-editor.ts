/**
 * The field group editor: the block tree in field group mode (field blocks and layout blocks)
 * with the side panel for a block's settings and its condition, applied as they change. Shared by the collection
 * builder and the field group screen. Client-safe: the blocks are control values, and the
 * screen saves them.
 */
import { Client, ClientState, Component, Cossack } from '@cossackframework/core';
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { FIELD_GROUP_LAYOUT, findBlock, updateBlock, type BlockCondition } from '@cossackframework/cms';
import { blockPanel } from './block-panel';
import { BlockTree } from './block-tree';
import { fieldName } from './builder';
import { conditionControl, conditionFields, type ConditionField } from './condition-control';
import { editorInput, type BlockOption, type EditorBlock } from './editor';
import { blockFields } from './field-controls';
import { styleValues } from './style-controls';

export type FieldGroupEditorProps = {
    /** Page-unique prefix for control IDs. */
    id: string;
    blocks: EditorBlock[];
    /** Every block type; the tree offers the field and layout blocks among them. */
    options: BlockOption[];
    /** The target's own fields a condition may test, such as an entry's status. */
    scope?: ConditionField[];
    /** The screen's validation message, for the tree to open and flash the block it names. */
    error?: string;
    onChange(blocks: EditorBlock[]): void;
};

/** The block open in the panel. */
interface Dialog { id: string; values: Record<string, unknown>; errors: Record<string, string>; when?: BlockCondition }

/** The block types a field group is built from. */
export function fieldGroupOptions(options: readonly BlockOption[]): BlockOption[] {
    return options.filter(option => option.field || FIELD_GROUP_LAYOUT.has(option.name));
}

@Component()
export class FieldGroupEditor extends Cossack {
    declare props: FieldGroupEditorProps;
    @ClientState() private dialog: Dialog | null = null;

    @Client()
    private open(id: string) {
        const block = findBlock(this.props.blocks, id);
        const option = this.props.options.find(entry => entry.name === block?.type);
        if (!block || !option) return;
        this.dialog = { id, errors: {}, values: Object.fromEntries(option.fields.map(field => [field.name, block.data[field.name] ?? ''])), ...(block.when ? { when: block.when } : {}) };
    }

    @Client()
    private setValue(name: string, value: unknown) {
        if (!this.dialog) return;
        const values = { ...this.dialog.values, [name]: value };
        // An unnamed field follows its label, as form inputs do.
        if (name === 'label' && !String(this.dialog.values.name ?? '').trim()) values.name = '';
        this.commit({ ...this.dialog, values, errors: { ...this.dialog.errors, [name]: '' } });
    }

    @Client()
    private setCondition(when: BlockCondition | null) {
        if (!this.dialog) return;
        const { when: _previous, ...rest } = this.dialog;
        this.commit(when ? { ...rest, when } : rest);
    }

    /**
     * The panel's values go into the block at once. A value its field cannot take stays in the
     * panel with its message; a missing name follows the label, as saving derives it.
     */
    @Client()
    private commit(dialog: Dialog) {
        const block = findBlock(this.props.blocks, dialog.id);
        const option = this.props.options.find(entry => entry.name === block?.type);
        if (!block || !option) return;
        const { input, errors } = editorInput(option.fields, dialog.values);
        if (option.field && !String(input.name ?? '').trim() && String(input.label ?? '').trim()) input.name = fieldName(String(input.label ?? ''));
        this.dialog = { ...dialog, errors: { ...dialog.errors, ...errors } };
        this.props.onChange(updateBlock(this.props.blocks, dialog.id, entry => {
            const { when: _previous, ...rest } = entry;
            return { ...rest, ...(dialog.when ? { when: dialog.when } : {}), data: { ...entry.data, ...input } };
        }));
    }

    render(): TemplateResult {
        const dialog = this.dialog;
        const block = dialog ? findBlock(this.props.blocks, dialog.id) : undefined;
        const option = this.props.options.find(entry => entry.name === block?.type) ?? null;
        const prefix = `${this.props.id}-block`;
        return html`<div class="space-y-3">
            ${component(BlockTree, {
                id: this.props.id, blocks: this.props.blocks, options: this.props.options, allowed: [], fieldGroup: true, error: this.props.error ?? '',
                onChange: (blocks: EditorBlock[]) => this.props.onChange(blocks), onEdit: (id: string) => this.open(id),
                control: () => null,
            })}
            ${blockPanel({
                id: prefix, open: Boolean(dialog && option), option, tab: 'general', style: styleValues({}), presets: { colors: [], fontSizes: [], spacing: [] }, styleTab: false,
                onTab: () => undefined, onStyle: () => undefined, onClose: () => { this.dialog = null; },
                general: dialog && option ? html`
                    ${option.fields.length ? blockFields(option, dialog.values, (name, value) => this.setValue(name, value), `${prefix}-${dialog.id}`, () => ({ previews: {}, choose: () => undefined }), dialog.errors)
                        : html`<p class="text-sm text-muted-foreground">${__('This block has no settings.')}</p>`}
                    ${conditionControl(dialog.when, [...(this.props.scope ?? []), ...conditionFields(this.props.blocks, this.props.options, dialog.id)], `${prefix}-${dialog.id}`,
                        when => this.setCondition(when ?? null),
                        { toggle: __('Conditional logic'), subject: __('this'), show: __('Show'), hide: __('Hide') })}` : html``,
            })}
        </div>`;
    }
}
