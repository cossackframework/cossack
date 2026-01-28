import { html } from "@cossackframework/renderer"
import { Cossack, Prop } from "@cossackframework/core"

export class Button extends Cossack {
    @Prop()
    variant: 'primary' | 'secondary' = 'primary';

    render() {
        const { variant, rest } = this.props;

        return html`
            <button data-variant="${this.variant}" ...=${rest}>
                ${this.children}
            </button>
        `
    }
}