import { html, type TemplateResult } from "@cossackframework/renderer"

export const Layout = (props: { dir: string }, children: TemplateResult) => {
    return html`
        <main dir="${props.dir}">
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
                ${children}
            </div>
        </main>
    `
}