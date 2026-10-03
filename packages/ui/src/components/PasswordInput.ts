import type { PasswordAttributes, ControlEvent } from "../native-attributes";
import { html, classMap, component, PreventDefaultResult, preventDefault } from "@cossackframework/renderer";
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

export type PasswordInputProps = PasswordAttributes & {
    /** Parent value. Unchanged values preserve native edits, including on reveal. */
    value?: string;
    /** Disable the input and its reveal button. Fieldset disabling also applies. */
    disabled?: boolean;
    /** Control size. Defaults to "default". */
    size?: "default" | "sm" | "lg";
    /** Called before the native @input listener with the value and native event. */
    onChange?: (value: string, event: ControlEvent<HTMLInputElement, InputEvent>) => unknown;
    /** Accessible names for the reveal button. Localize these with the field label. */
    showLabel?: string;
    hideLabel?: string;
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
        const { value, placeholder = "••••••••", autocomplete = "current-password",
            size = "default", disabled = false, onChange, showLabel = "Show password",
            hideLabel = "Hide password", '@input': nativeInput, ...rest } = this.props;
        const onInput: EventListener = event => {
            const inputEvent = event as ControlEvent<HTMLInputElement, InputEvent>;
            onChange?.(inputEvent.currentTarget.value, inputEvent);
            if (typeof nativeInput === 'function') nativeInput(inputEvent);
            else if (nativeInput instanceof PreventDefaultResult) nativeInput.handler.call(inputEvent.currentTarget, inputEvent);
        };
        const inputHandler = nativeInput instanceof PreventDefaultResult
            ? preventDefault(onInput, { novalidate: nativeInput.novalidate }) : onInput;

        return html`
            <div class="cs-password-input relative inline-block w-full">
                <input
                    ref=${this.inputRef}
                    type=${this.revealed ? "text" : "password"}
                    .value=${value ?? ""}
                    placeholder=${placeholder}
                    autocomplete=${autocomplete}
                    ?disabled=${disabled}
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
                    @input=${inputHandler}
                    ...=${rest}
                />
                <button
                    type="button"
                    ?disabled=${disabled}
                    class="cs-password-input__toggle absolute right-2 top-1/2 -translate-y-1/2 size-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer border-none bg-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] [&_svg]:size-4 [&_svg]:shrink-0"
                    aria-label=${this.revealed ? hideLabel : showLabel}
                    aria-controls=${rest.id}
                    aria-pressed=${this.revealed}
                    @click=${(event: MouseEvent) => this.toggleReveal(event)}
                >
                    ${component(Icon, { entry: this.revealed ? EyeClosedIcon : EyeIcon, size: 16 })}
                </button>
            </div>
        `;
    }

    @Client()
    private async toggleReveal(event: MouseEvent) {
        const input = this.inputRef.value;
        if (!input || input.matches(':disabled')) return;
        const button = event.currentTarget;
        const pointer = event.detail > 0;
        const value = input.value;
        const start = input.selectionStart, end = input.selectionEnd, direction = input.selectionDirection;
        this.revealed = !this.revealed;
        await this.requestUpdate();
        if (!input.isConnected || input !== this.inputRef.value || input.matches(':disabled')) return;
        if (input.value === value && start !== null && end !== null) input.setSelectionRange(start, end, direction ?? undefined);
        // Keyboard users keep the toggle focused so they can operate it again.
        // Pointer users return to the field unless focus deliberately moved elsewhere.
        if (pointer && (document.activeElement === button || document.activeElement === input)) {
            input.focus({ preventScroll: true });
        }
    }
}
