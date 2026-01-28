import { html } from "@cossackframework/renderer"
import { Cossack, Component, Prop } from "@cossackframework/core"

@Component()
export class Button extends Cossack {
    @Prop()
    variant: 'primary' | 'secondary' = 'primary';

    render() {
        const { variant, ...rest } = this.props;

        return html`
            <button data-variant="${this.variant}" ...=${rest}>
                ${this.children}
            </button>
        `
    }
}