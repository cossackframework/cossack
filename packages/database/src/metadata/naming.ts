export interface NamingStrategy {
  tableName(entityName: string): string;
  columnName(propertyName: string): string;
  relationJoinColumn(propertyName: string, referencedColumn: string): string;
  joinTableName(ownerTable: string, propertyName: string, inverseTable: string): string;
}

export function snakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .replace(/[\s.-]+/g, "_")
    .toLowerCase();
}

function pluralize(value: string): string {
  if (/(s|x|z|ch|sh)$/.test(value)) return `${value}es`;
  if (/[^aeiou]y$/.test(value)) return `${value.slice(0, -1)}ies`;
  return `${value}s`;
}

export const defaultNamingStrategy: NamingStrategy = Object.freeze({
  tableName: (entityName: string) => pluralize(snakeCase(entityName)),
  columnName: snakeCase,
  relationJoinColumn: (propertyName: string, referencedColumn: string) =>
    `${snakeCase(propertyName)}_${snakeCase(referencedColumn)}`,
  joinTableName: (ownerTable: string, propertyName: string, inverseTable: string) =>
    `${ownerTable}_${snakeCase(propertyName)}_${inverseTable}`,
});
