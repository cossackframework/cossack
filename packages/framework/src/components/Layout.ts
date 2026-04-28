import { html } from "@cossackframework/renderer"
import { Cossack, Component, Prop } from "@cossackframework/core"

@Component()
export class Layout extends Cossack {
    @Prop()
    dir: string = 'ltr';

    render() {
        return html`
            <main dir="${this.dir}" class="flex">
                <aside class="w-[200px] bg-gray-100 p-2.5 m-2.5">
                    <nav>
                        <ul>
                            <li><a href="/">Home</a></li>
                            <li><a href="/about">About</a></li>
                            <li><a href="/contact">Contact</a></li>
                        </ul>
                    </nav>
                </aside>
                <div class="m-2.5">
                    ${this.children}
                </div>
            </main>
        `
    }
}