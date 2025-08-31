import { html, type TemplateResult } from "@cossackframework/renderer"

type ButtonProps = {
    variant?: 'primary' | 'secondary'
    [key: string]: any
}

export const Button = (props: ButtonProps, children: TemplateResult) => {
    const { variant = 'primary', ...rest } = props
    
    return html`
        <button data-variant="${variant}" ...=${rest}>
            ${children}
        </button>
    `
}