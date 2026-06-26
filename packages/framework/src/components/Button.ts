import { html } from "@cossackframework/renderer"
import { Cossack, Component } from "@cossackframework/core"

interface ButtonProps {
    variant?: 'primary' | 'secondary';
    // Allow arbitrary HTML attributes to spread onto the native <button>
    [key: string]: any;
}

@Component()
export class Button extends Cossack {
    // Type-only override: inputs are passed via `this.props` from the parent.
    declare props: ButtonProps;

    render() {
        const { variant = 'primary', ...rest } = this.props;

        return html`
            <button data-variant="${variant}" class="bg-blue-500 hover:bg-blue-700 text-white py-2.5 px-5 cursor-pointer border-none disabled:opacity-60 disabled:cursor-not-allowed" ...=${rest}>
                ${this.children}
            </button>
        `
    }
}
