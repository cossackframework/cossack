import { html, classMap } from "@cossackframework/renderer";
import {
    Cossack,
    Component,
    Client,
    ClientState,
    createRef,
    type RefObject,
} from "@cossackframework/core";

export interface PasswordInputProps {
    /** Current password value. */
    value?: string;
    /** Placeholder text. */
    placeholder?: string;
    /** Control size. */
    size?: "sm" | "md" | "lg";
    /** Called on every input change with the new value. */
    onChange?: (value: string) => void;
    /** Pass-through HTML attributes (name, autocomplete, ...). */
    [key: string]: any;
}

const SIZES: Record<NonNullable<PasswordInputProps["size"]>, string> = {
    sm: "text-sm px-2.5 py-1.5",
    md: "text-base px-3 py-2",
    lg: "text-lg px-4 py-2.5",
};

/**
 * Cossack UI PasswordInput — password field with show/hide (eye) toggle.
 *
 * The eye button reflects the current reveal state: open eye when the password
 * is hidden, slashed eye when revealed. Clicking toggles between `password`
 * and `text` input types.
 *
 *   ${component(PasswordInput, {
 *       value: this.password,
 *       onChange: (v) => { this.password = v; },
 *   })}
 */
@Component()
export class PasswordInput extends Cossack {
    declare props: PasswordInputProps;

    @ClientState() private revealed = false;
    inputRef: RefObject<HTMLInputElement> = createRef<HTMLInputElement>();

    render() {
        const { value, placeholder, size = "md", ...rest } = this.props;

        return html`
            <div class="cs-password-input relative inline-block w-full">
                <input
                    ref=${this.inputRef}
                    type=${this.revealed ? "text" : "password"}
                    .value=${value || ""}
                    placeholder=${placeholder || "••••••••"}
                    autocomplete="current-password"
                    class=${classMap({
                        "cs-password-input__field": true,
                        [`cs-password-input--${size}`]: true,
                        "w-full rounded-md border border-border bg-background text-foreground outline-none": true,
                        "transition-colors transition-shadow duration-150": true,
                        "focus:border-primary focus:ring-2 focus:ring-primary/20": true,
                        "disabled:opacity-50 disabled:cursor-not-allowed": true,
                        "pr-10": true,
                        [SIZES[size]]: true,
                    })}
                    @input=${(e: InputEvent) => this.handleInput(e)}
                    ...=${rest}
                />
                <button
                    type="button"
                    class="cs-password-input__toggle absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer border-none bg-transparent transition-colors"
                    aria-label=${this.revealed ? "Hide password" : "Show password"}
                    aria-pressed=${this.revealed}
                    @click=${() => this.toggleReveal()}
                >
                    ${this.revealed ? this.eyeOffIcon() : this.eyeIcon()}
                </button>
            </div>
        `;
    }

    private eyeIcon() {
        return html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" stroke="currentColor" stroke-width="1.5"/>
            <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/>
        </svg>`;
    }

    private eyeOffIcon() {
        return html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9.9 4.24A9.12 9.12 0 0112 4c6.5 0 10 7 10 7a13.16 13.16 0 01-1.67 2.68" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M6.61 6.61A13.526 13.526 0 002 12s3.5 7 10 7a9.11 9.11 0 005.39-1.61" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M14.12 14.12A3 3 0 119.88 9.88" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M2 2l20 20" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>`;
    }

    @Client()
    private toggleReveal() {
        this.revealed = !this.revealed;
        // Keep focus on the input after toggling.
        requestAnimationFrame(() => this.inputRef.value?.focus());
    }

    @Client()
    private handleInput(e: InputEvent) {
        const value = (e.target as HTMLInputElement).value;
        this.props.onChange?.(value);
    }
}
