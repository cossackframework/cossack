import { CossackElement } from './cossack-element';

export interface ComponentResult {
    _type: 'COMPONENT';
    clazz: new () => CossackElement;
    props: Record<string, unknown>;
    children: unknown;
}

export const component = <T extends CossackElement>(
    clazz: new () => T,
    props: Record<string, unknown> = {},
    children?: unknown
): ComponentResult => {
    return {
        _type: 'COMPONENT',
        clazz,
        props,
        children
    };
};

export const isComponentResult = (value: unknown): value is ComponentResult => {
    return typeof value === 'object' && value !== null && (value as any)._type === 'COMPONENT';
};
