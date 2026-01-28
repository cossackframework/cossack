export interface Context<T> {
    __context__: true;
    defaultValue?: T;
}

export const createContext = <T>(defaultValue?: T): Context<T> => {
    return {
        __context__: true,
        defaultValue
    };
};
