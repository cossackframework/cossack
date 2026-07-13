import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component, ClientState } from "@cossackframework/core";

export interface ToggleProps {
    /** Pressed state. */
    pressed?: boolean;
    /** Default pressed for uncontrolled mode. */
    defaultPressed?: boolean;
    /** Size. */
    size?: "sm" | "md" | "lg";
    /** Callback when pressed state changes. */
    onPressedChange?: (pressed: boolean) => void;
    [key: string]: any;
}

const SIZES: Record<string, string> = {
    sm: "h-8 px-2 text-sm",
    md: "h-9 px-3 text-sm",
    lg: "h-10 px-4 text-base",
};

/**
 * Cossack UI Toggle — a two-state button (pressed/unpressed).
 *
 *   ${component(Toggle, { pressed: this.bold, onPressedChange: (v) => this.bold = v },
 *       html\`<strong>B</strong>\`)}
 */
@Component()
export class Toggle extends Cossack {
    declare props: ToggleProps;

    @ClientState() internalPressed = false;
    @ClientState() userInteracted = false;

    render() {
        const { size = "md", ...rest } = this.props;
        let pressed: boolean;
        if (this.props.pressed !== undefined) pressed = !!this.props.pressed;
        else if (this.userInteracted) pressed = this.internalPressed;
        else { pressed = !!this.props.defaultPressed; this.internalPressed = pressed; }

        const classes = classMap({
            "cs-toggle": true,
            [SIZES[size]]: true,
            "inline-flex items-center justify-center rounded-md border cursor-pointer select-none transition-colors": true,
            "bg-primary text-primary-foreground border-primary": pressed,
            "bg-transparent text-foreground border-border hover:bg-muted": !pressed,
        });

        return html`
            <button
                type="button"
                class=${classes}
                aria-pressed=${pressed ? "true" : "false"}
                @click=${() => {
                    const next = !pressed;
                    if (this.props.pressed !== undefined) {
                        this.props.onPressedChange?.(next);
                    } else {
                        this.userInteracted = true;
                        this.internalPressed = next;
                        this.props.onPressedChange?.(next);
                    }
                }}
                ...=${rest}
            >${this.children}</button>
        `;
    }
}
