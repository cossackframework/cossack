export interface IconCatalogCategory { id: string; label: string; names: string[] }
export interface IconCatalog { version: string; categories: IconCatalogCategory[] }
export function categoryId(label: string): string;
export function catalog(): Promise<IconCatalog>;
export function render(catalog: IconCatalog): string;
