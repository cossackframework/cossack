/** A scalar URL setting backed by the dashboard's existing media library and upload pipeline. */
import { Client, ClientState, Component, Cossack } from '@cossackframework/core';
import type { FieldMediaKind } from '@cossackframework/cms';
import { Button, Input, type FieldControlAttributes } from '@cossackframework/ui';
import { component, html } from '@cossackframework/renderer';
import type { MediaPreview } from './field-controls';
import { closedChooser, mediaChooser, uploadFile, type MediaChooserState } from './media-chooser';
import { notice } from './ui';

export interface SettingsMedia {
    find(search: string, kind: string): Promise<MediaPreview[]>;
    canUpload: boolean;
    /** Changes when the owner discards or replaces its draft, even if this value stays equal. */
    epoch?(): unknown;
}

export type SettingsFileProps = {
    attributes: FieldControlAttributes;
    label: string;
    value: string;
    disabled: boolean;
    kinds?: readonly FieldMediaKind[];
    media?: SettingsMedia;
    onChange(value: string): void;
};

@Component()
export class SettingsFile extends Cossack {
    declare props: SettingsFileProps;
    @ClientState() private chooser: MediaChooserState = closedChooser();
    @ClientState() private error = '';
    @ClientState() private uploading = false;
    private request = 0;
    private uploadAbort?: AbortController;
    private destroyed = false;

    onCleanup() { this.destroyed = true; this.request++; this.uploadAbort?.abort(); }

    @Client()
    async open() {
        if (this.props.disabled || !this.props.media) return;
        this.error = '';
        this.chooser = { ...closedChooser(), open: true, field: this.props.attributes.id, kind: this.props.kinds?.[0] ?? '',
            accept: '', canUpload: this.props.media.canUpload, uploadMultiple: false };
        await this.search('');
    }

    @Client()
    close() { this.request++; this.chooser = { ...this.chooser, open: false }; }

    @Client()
    async search(search: string) {
        if (!this.props.media) return;
        const request = ++this.request;
        this.chooser = { ...this.chooser, search, error: '' };
        try {
            const items = await this.props.media.find(search, this.chooser.kind);
            if (request === this.request && !this.destroyed) this.chooser = { ...this.chooser, items };
        } catch (error) {
            if (request === this.request && !this.destroyed) this.chooser = { ...this.chooser, error: error instanceof Error ? error.message : __('The media library could not be loaded.') };
        }
    }

    @Client()
    async filter(kind: string) {
        this.chooser = { ...this.chooser, kind };
        await this.search(this.chooser.search);
    }

    @Client()
    choose(file: MediaPreview) {
        if (this.props.disabled) return;
        this.props.onChange(file.url);
        this.close();
    }

    @Client()
    async upload(event: Event) {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (!file || this.uploading || this.props.disabled || !this.props.media?.canUpload) return;
        this.error = '';
        const epoch = this.props.media.epoch?.();
        const original = this.props.value;
        const id = this.props.attributes.id;
        const controller = new AbortController();
        this.uploadAbort = controller;
        this.uploading = true;
        this.chooser = { ...this.chooser, busy: true, error: '' };
        try {
            const uploaded = await uploadFile(file, controller.signal);
            if (!this.destroyed && !this.props.disabled && this.props.attributes.id === id && this.props.value === original && this.props.media?.epoch?.() === epoch) {
                this.props.onChange(uploaded.url);
                this.close();
            }
        } catch (error) {
            if (!controller.signal.aborted && !this.destroyed && this.props.attributes.id === id && this.props.value === original && this.props.media?.epoch?.() === epoch) {
                this.error = error instanceof Error ? error.message : __('The upload failed.');
                this.chooser = { ...this.chooser, error: this.error };
            }
        } finally {
            this.uploadAbort = undefined;
            this.uploading = false;
            this.chooser = { ...this.chooser, busy: false };
        }
    }

    render() {
        const { attributes, label, value, disabled, media } = this.props;
        return html`<div class="space-y-2">
            ${component(Input, { ...attributes, type: 'text', disabled, placeholder: '/media/…', '.value': value,
                '@input': (event: Event) => this.props.onChange((event.target as HTMLInputElement).value) })}
            <div class="flex flex-wrap items-center gap-2">
                ${media ? component(Button, { type: 'button', size: 'sm', variant: 'outline', disabled: disabled || this.uploading, '@click': this.open }, __('Choose file')) : null}
                ${media?.canUpload ? html`<label class=${`relative inline-flex items-center rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted focus-within:ring-2 focus-within:ring-ring ${disabled || this.uploading ? 'opacity-50' : 'cursor-pointer'}`}>
                    ${this.uploading ? __('Uploading…') : __('Upload file')}
                    <input id=${`${attributes.id}-upload`} type="file" aria-label=${`${__('Upload file')}: ${label}`}
                        class="absolute inset-0 w-full cursor-pointer opacity-0" ?disabled=${disabled || this.uploading} @change=${this.upload}>
                </label>` : null}
                ${value ? component(Button, { type: 'button', size: 'sm', variant: 'ghost', disabled, 'aria-label': `${__('Clear file')}: ${label}`, '@click': () => this.props.onChange('') }, __('Clear')) : null}
            </div>
            ${this.error && !this.chooser.open ? notice(this.error, 'error') : null}
            ${this.chooser.open ? mediaChooser(this.chooser, { search: this.search, filter: this.filter, choose: this.choose, upload: this.upload, close: this.close }) : null}
        </div>`;
    }
}
