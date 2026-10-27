import { html, type TemplateResult } from "@cossackframework/renderer";
import { Client, ClientState, Component, Cossack } from "@cossackframework/core";
import type { CodeEditorHandle } from "../internal/code-editor.client";

export type CodeEditorProps = {
    /** The element ID of the editor's surface. */
    id: string;
    value: string;
    /** `json`, `javascript`, `typescript`, `html`, `css`, `markdown`, or any name CodeMirror's language data knows; empty for plain text. */
    language?: string;
    /** Spoken name of the editor, for assistive technology. */
    label?: string;
    placeholder?: string;
    readOnly?: boolean;
    /** Show the value as a unified diff against this text, read-only. */
    original?: string;
    /** Classes of the frame; the default gives a bordered box with a minimum height. */
    class?: string;
    onChange?(value: string): void;
};

/**
 * Cossack UI CodeEditor — a CodeMirror 6 editor with syntax highlighting, loaded in the
 * browser on first use. The server renders the text in a plain box, so the page is complete
 * before the editor arrives and without JavaScript.
 *
 *   <${CodeEditor} id="body" language="json" .value=${text} .onChange=${value => (this.text = value)} />
 */
@Component()
export class CodeEditor extends Cossack {
    declare props: CodeEditorProps;
    @ClientState() private ready = false;
    @ClientState() private failed = false;
    private handle?: CodeEditorHandle;
    private surface?: HTMLElement;
    private language = "";

    /** A value or language set from outside reaches the editor; its own edits come back unchanged and are left alone. */
    @Client()
    updated(changed: Map<string | number | symbol, unknown>) {
        super.updated(changed);
        if (!this.handle || !this.ready) return;
        this.handle.setValue(this.props.value ?? "");
        const language = this.props.language ?? "";
        if (language !== this.language) { this.language = language; void this.handle.setLanguage(language); }
    }

    @Client()
    private async connect(element: Element | undefined) {
        if (!element || this.surface === element) return;
        this.surface = element as HTMLElement;
        try {
            const { mountCodeEditor } = await import("../internal/code-editor.client");
            this.handle?.destroy();
            this.surface.replaceChildren();
            this.language = this.props.language ?? "";
            this.handle = mountCodeEditor(this.surface, {
                value: this.props.value ?? "", language: this.language, readOnly: this.props.readOnly === true || this.props.original !== undefined,
                placeholder: this.props.placeholder ?? "", label: this.props.label ?? "Code", original: this.props.original ?? null,
                onChange: value => this.props.onChange?.(value),
            });
            this.ready = true;
        } catch (error) {
            console.error("[ui] the code editor could not load", error);
            this.failed = true;
        }
    }

    onCleanup() {
        this.handle?.destroy();
        this.handle = undefined;
    }

    render(): TemplateResult {
        const frame = this.props.class ?? "min-h-[8rem] rounded-md border border-input bg-background shadow-xs focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]";
        // Until the editor mounts, the text sits in a box of the same shape; the editor replaces it.
        return html`<div class=${`cs-code-editor ${frame} overflow-hidden text-sm`} data-language=${this.props.language ?? ""}>
            ${this.failed ? html`<p role="alert" class="px-3 py-2 text-xs text-destructive">The code editor could not load. Reload the page to try again.</p>` : null}
            <div id=${this.props.id} class="cs-code-editor__surface" ref=${(element: Element) => this.connect(element)}>
                ${this.ready ? null : html`<pre class="m-0 whitespace-pre-wrap break-words px-3 py-2 font-mono text-[0.8125rem] leading-6 text-foreground">${this.props.value ?? ""}</pre>`}
            </div>
        </div>`;
    }
}
