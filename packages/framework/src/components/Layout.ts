import { html } from "@cossackframework/renderer"
import { Cossack, Component, Prop } from "@cossackframework/core"

@Component()
export class Layout extends Cossack {
    @Prop()
    dir: string = 'ltr';

    render() {
        return html`
            <main dir="${this.dir}">
                <aside>
                    <nav>
                        <ul>
                            <li><a href="/">Home</a></li>
                            <li><a href="/about">About</a></li>
                            <li><a href="/contact">Contact</a></li>
                        </ul>
                    </nav>
                </aside>
                <div>
                    ${this.children}
                </div>
            </main>
        `
    }
}