import { Part, PartType } from '../types';
export declare class ChildPart implements Part {
    private start;
    private end;
    constructor(start: Comment, end: Comment);
    commit(value: unknown): void;
    private toNodes;
    private toNode;
}
export declare class AttributePart implements Part {
    element: Element;
    name: string;
    type: PartType;
    constructor(element: Element, name: string, type: PartType);
    commit(value: unknown): void;
}
export declare class SpreadPart implements Part {
    element: Element;
    private _previousProps;
    constructor(element: Element);
    commit(value: unknown): void;
}
