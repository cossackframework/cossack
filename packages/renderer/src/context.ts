export interface Context<T> {
  id: string;
  defaultValue?: T;
}

export function createContext<T>(defaultValue?: T): Context<T> {
  return {
    id: Math.random().toString(36).slice(2),
    defaultValue
  };
}
