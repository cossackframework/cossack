export type PartType = 'attribute' | 'property' | 'boolean' | 'event';
export interface Part {
    commit(value: unknown): void;
}
export declare class TemplateResult {
    strings: TemplateStringsArray;
    values: readonly unknown[];
    constructor(strings: TemplateStringsArray, values: readonly unknown[]);
}
export type Result = TemplateResult | string | number | boolean | null | undefined;
