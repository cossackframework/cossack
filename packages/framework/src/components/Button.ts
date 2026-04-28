import { html } from "@cossackframework/renderer"
import { Cossack, Component, Prop } from "@cossackframework/core"

@Component()
export class Button extends Cossack {
    @Prop()
    variant: 'primary' | 'secondary' = 'primary';

    render() {
        const { variant, ...rest } = this.props;

        return html`
            <button data-variant="${this.variant}" class="bg-blue-500 hover:bg-blue-700 text-white py-2.5 px-5 cursor-pointer border-none disabled:opacity-60 disabled:cursor-not-allowed" ...=${rest}>
                ${this.children}
            </button>
        `
    }
}