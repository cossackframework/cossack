import { html, classMap } from "@cossackframework/renderer";
import {
    Cossack,
    Component,
    Client,
    ClientState,
    createRef,
    type RefObject,
} from "@cossackframework/core";

export interface InputOTPProps {
    /** Number of input boxes. Default 6. */
    length?: number;
    /** Current OTP value. */
    value?: string;
    /** Called with the full OTP string on every change. */
    onChange?: (value: string) => void;
    /** Called when all boxes are filled. */
    onComplete?: (value: string) => void;
    /** Input box size. */
    size?: "sm" | "md" | "lg";
    [key: string]: any;
}

const SIZES: Record<NonNullable<InputOTPProps["size"]>, string> = {
    sm: "w-9 h-11 text-base",
    md: "w-11 h-12 text-lg",
    lg: "w-12 h-14 text-xl",
};

/**
 * Cossack UI InputOTP — segmented one-time-password input.
 *
 * Each digit lives in its own `<input maxlength=1>`. Arrow keys, Backspace,
 * and paste (entire code at once) are all handled. The component owns the
 * per-box state internally and mirrors the joined value via `onChange`.
 *
 *   ${component(InputOTP, {
 *       length: 6,
 *       onChange: (v) => { this.otp = v; },
 *       onComplete: (v) => verify(v),
 *   })}
 */
@Component()
export class InputOTP extends Cossack {
    declare props: InputOTPProps;

    /** Per-box characters. */
    @ClientState() private boxes: string[] = [];

    inputsRef: RefObject<HTMLDivElement> = createRef<HTMLDivElement>();

    render() {
        const { length = 6, size = "md" } = this.props;
        const len = Math.max(1, length);

        // Initialize on first render.
        if (this.boxes.length !== len) {
            const initial = (this.props.value || "").slice(0, len).split("");
            while (initial.length < len) initial.push("");
            this.boxes = initial;
        }

        return html`
            <div
                ref=${this.inputsRef}
                class="cs-input-otp flex items-center gap-2"
                @paste=${(e: ClipboardEvent) => this.handlePaste(e)}
            >
                ${this.boxes.map((char, i) => html`
                    <input
                        type="text"
                        inputmode="numeric"
                        maxlength="1"
                        autocomplete="off"
                        .value=${char}
                        class=${classMap({
                            "cs-input-otp__box": true,
                            "rounded-md border border-border bg-background text-center font-medium text-foreground outline-none transition-colors": true,
                            "focus:border-primary": true,
                            [SIZES[size]]: true,
                        })}
                        @input=${(e: InputEvent) => this.handleInput(e, i)}
                        @keydown=${(e: KeyboardEvent) => this.handleKeydown(e, i)}
                        aria-label=${`Digit ${i + 1} of ${len}`}
                    />
                `)}
            </div>
        `;
    }

    @Client()
    private handleInput(e: InputEvent, i: number) {
        const input = e.target as HTMLInputElement;
        // Keep only the last digit typed.
        const raw = input.value.replace(/\D/g, "").slice(-1);
        input.value = raw;
        const next = [...this.boxes];
        next[i] = raw;
        this.boxes = next;
        this.emit();
        // Auto-advance.
        if (raw && i < this.boxes.length - 1) {
            const container = this.inputsRef.value;
            const el = container?.querySelectorAll<HTMLInputElement>("input")[i + 1];
            el?.focus();
        }
    }

    @Client()
    private handleKeydown(e: KeyboardEvent, i: number) {
        if (e.key === "Backspace" && !inputValue(e) && i > 0) {
            // Empty box + Backspace → focus previous.
            e.preventDefault();
            const container = this.inputsRef.value;
            const el = container?.querySelectorAll<HTMLInputElement>("input")[i - 1];
            el?.focus();
            el?.select();
        } else if (e.key === "ArrowLeft" && i > 0) {
            e.preventDefault();
            const container = this.inputsRef.value;
            const el = container?.querySelectorAll<HTMLInputElement>("input")[i - 1];
            el?.focus();
        } else if (e.key === "ArrowRight" && i < this.boxes.length - 1) {
            e.preventDefault();
            const container = this.inputsRef.value;
            const el = container?.querySelectorAll<HTMLInputElement>("input")[i + 1];
            el?.focus();
        }
    }

    @Client()
    private handlePaste(e: ClipboardEvent) {
        e.preventDefault();
        const text = (e.clipboardData?.getData("text") || "").replace(/\D/g, "");
        if (!text) return;
        const next = [...this.boxes];
        for (let k = 0; k < text.length && k < next.length; k++) {
            next[k] = text[k];
        }
        this.boxes = next;
        this.emit();
        // Focus the last filled (or next empty) box.
        const container = this.inputsRef.value;
        const inputs = container?.querySelectorAll<HTMLInputElement>("input");
        const focusIdx = Math.min(text.length, next.length - 1);
        inputs?.[focusIdx]?.focus();
    }

    @Client()
    private emit() {
        const joined = this.boxes.join("");
        this.props.onChange?.(joined);
        if (joined.length === this.boxes.length && !joined.includes("")) {
            this.props.onComplete?.(joined);
        }
    }
}

function inputValue(e: KeyboardEvent): string {
    return (e.target as HTMLInputElement).value;
}
