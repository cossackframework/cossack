import { html, type TemplateResult } from "@cossackframework/renderer"

type ComponentProps<T> = Omit<Partial<T>, 'children'>;

type ButtonProps = ComponentProps<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary';
    [key: string]: any; // Allow any other props like event handlers
};

export const Button = (props: ButtonProps, children: TemplateResult) => {
    const { variant = 'primary', ...rest } = props

    return html`
        <button data-variant="${variant}" ...=${rest}>
            ${children}
        </button>
    `
}