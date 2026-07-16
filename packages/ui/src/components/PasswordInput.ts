import { html, classMap, component } from "@cossackframework/renderer";
import {
    Cossack,
    Component,
    Client,
    ClientState,
    createRef,
    type RefObject,
} from "@cossackframework/core";
import { Icon } from "../icons/Icon";
import { EyeIcon } from "@cossackframework/solar-icons/eye";
import { EyeClosedIcon } from "@cossackframework/solar-icons/eye-closed";

export interface PasswordInputProps {
    /** Current password value. */
    value?: string;
    /** Placeholder text. */
    placeholder?: string;
    /** Control size. Defaults to "default". */
    size?: "default" | "sm" | "lg";
    /** Called on every input change with the new value. */
    onChange?: (value: string) => void;
    /** Pass-through HTML Attributes (name, autocomplete, ...). */
    [key: string]: any;
}

const SIZES: Record<NonNullable<PasswordInputProps["size"]>, string> = {
    default: "h-9 px-3 py-1 text-base md:text-sm",
    sm: "h-8 rounded-md px-2 text-sm",
    lg: "h-10 rounded-md px-4 text-base",
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
        const { value, placeholder, size = "default", ...rest } = this.props;

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
                        "w-full rounded-md border bg-transparent": true,
                        "text-base shadow-xs outline-none md:text-sm": true,
                        "transition-[color,box-shadow]": true,
                        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]": true,
                        "aria-invalid:border-destructive aria-invalid:ring-destructive/20": true,
                        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50": true,
                        "pr-10": true,
                        [SIZES[size]]: true,
                    })}
                    @input=${(e: InputEvent) => this.handleInput(e)}
                    ...=${rest}
                />
                <button
                    type="button"
                    class="cs-password-input__toggle absolute right-2 top-1/2 -translate-y-1/2 size-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer border-none bg-transparent transition-colors [&_svg]:size-4 [&_svg]:shrink-0"
                    aria-label=${this.revealed ? "Hide password" : "Show password"}
                    aria-pressed=${this.revealed}
                    @click=${() => this.toggleReveal()}
                >
                    ${component(Icon, { entry: this.revealed ? EyeClosedIcon : EyeIcon, size: 16 })}
                </button>
            </div>
        `;
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
