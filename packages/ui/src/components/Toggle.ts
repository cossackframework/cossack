import { html, classMap, PreventDefaultResult, preventDefault } from "@cossackframework/renderer";
import { Cossack, Component, ClientState } from "@cossackframework/core";

import type { ButtonAttributes, ControlEvent } from '../native-attributes';

export type ToggleProps = Omit<ButtonAttributes, 'type' | 'role' | 'aria-pressed' | 'popovertarget' | 'popovertargetaction'> & {
    pressed?: boolean;
    defaultPressed?: boolean;
    size?: 'default' | 'sm' | 'lg' | 'icon';
    onPressedChange?: (pressed: boolean) => unknown;
};

const SIZES: Record<string, string> = {
    sm: "h-8 px-2 text-sm",
    default: "h-9 px-3 text-sm",
    lg: "h-10 px-4 text-base",
    icon: "size-9",
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

    @ClientState() private localPressed: boolean | undefined;
    private initialPressed?: boolean;
    private currentPressed() {
        this.initialPressed ??= !!this.props.defaultPressed;
        return this.props.pressed ?? this.localPressed ?? this.initialPressed;
    }
    render() {
        const { size = 'default', pressed: _pressed, defaultPressed: _default, onPressedChange: _change, '@click': supplied, ...rest } = this.props;
        if (!Object.hasOwn(SIZES, size)) throw new Error('Toggle size must be default, sm, lg or icon.');
        const pressed = this.currentPressed();
        const click: EventListener = event => {
            if (typeof supplied === 'function') supplied(event as ControlEvent<HTMLButtonElement, PointerEvent>);
            else if (supplied instanceof PreventDefaultResult) supplied.handler.call(event.currentTarget, event);
            if (event.defaultPrevented || (event.currentTarget as HTMLButtonElement).matches(':disabled')) return;
            const next = !this.currentPressed();
            if (this.props.pressed === undefined) this.localPressed = next;
            this.props.onPressedChange?.(next);
        };

        const classes = classMap({
            "cs-toggle": true,
            [SIZES[size]]: true,
            "inline-flex items-center justify-center gap-2 rounded-md cursor-pointer select-none": true,
            "transition-colors outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]": true,
            "[&_svg]:size-4 [&_svg]:shrink-0 disabled:opacity-50 disabled:cursor-not-allowed": true,
            "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90": pressed,
            "bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground": !pressed,
        });

        return html`
            <button
                type="button"
                class=${classes}
                aria-pressed=${pressed ? "true" : "false"}
                ...=${{ ...rest, '@click': supplied instanceof PreventDefaultResult ? preventDefault(click, { novalidate: supplied.novalidate }) : click }}
            >${this.children}</button>
        `;
    }
}
