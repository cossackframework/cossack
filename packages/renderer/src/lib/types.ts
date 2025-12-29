export type PartType = 'attribute' | 'property' | 'boolean' | 'event' | 'ref';

export interface Part {
  commit(value: unknown): void;
}
export class TemplateResult {
  constructor(
    public strings: TemplateStringsArray,
    public values: readonly unknown[]
  ) {}
}
export type Result = TemplateResult | string | number | boolean | null | undefined;