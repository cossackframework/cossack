import { CossackElement } from './cossack-element';

export interface ComponentResult {
    _type: 'COMPONENT';
    clazz: new () => CossackElement;
    props: Record<string, unknown>;
    children: unknown;
    /** Rendering owner captured when component() is evaluated. */
    parent?: CossackElement | null;
    /** Framework-private scope captured from the rendering owner. */
    serviceScope?: unknown;
}

export const isComponentResult = (value: unknown): value is ComponentResult => {
    return typeof value === 'object' && value !== null && (value as any)._type === 'COMPONENT';
};
