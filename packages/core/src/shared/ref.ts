export interface RefObject<T = any> {
    value: T | undefined;
}

export function createRef<T = any>(): RefObject<T> {
    return { value: undefined };
}
