import { html } from "@cossackframework/renderer"
import { Cossack, Component } from "@cossackframework/core"

interface LayoutProps {
    dir?: string;
    // Allow arbitrary HTML attributes to spread onto the root element
    [key: string]: any;
}

@Component()
export class Layout extends Cossack {
    // Type-only override: inputs are passed via `this.props` from the parent.
    declare props: LayoutProps;

    render() {
        const { dir = 'ltr' } = this.props;

        return html`
            <main dir="${dir}" class="flex">
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
