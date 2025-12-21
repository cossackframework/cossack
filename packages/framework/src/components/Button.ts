import { html, type TemplateResult } from "@cossackframework/renderer"

type ComponentProps<T> = Omit<Partial<T>, 'children' | 'style' | 'class'> & {
    style?: string | Partial<CSSStyleDeclaration> | Record<string, string | number>;
    class?: string;
};

type ButtonProps = ComponentProps<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary';
    [key: string]: any; 
};

export const Button = (props: ButtonProps, children: TemplateResult|string) => {
    const { variant = 'primary', ...rest } = props

    return html`
        <button data-variant="${variant}" ...=${rest}>
            ${children}
        </button>
    `
}