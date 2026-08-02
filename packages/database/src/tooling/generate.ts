import { dialectFor } from "../dialect/dialects.js";
import { renderOperation } from "../schema/ddl.js";
import type { SchemaOperation } from "../schema/operations.js";
import type { OrmSchema } from "../schema/types.js";

function className(value: string): string {
  const name = value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
  return /^\d/.test(name) ? `Model${name}` : name || "Model";
}

function propertyName(value: string): string {
  const name = value.replace(/[^a-zA-Z0-9_$]+(.)/g, (_match, next: string) => next.toUpperCase());
  return /^\d/.test(name) ? `column${name}` : name;
}

function tsType(logicalType: string, nullable: boolean): string {
  const base =
    logicalType === "integer" || logicalType === "decimal" ? "number"
    : logicalType === "bigint" ? "bigint"
    : logicalType === "boolean" ? "boolean"
    : logicalType === "datetime" || logicalType === "date" ? "Date"
    : logicalType === "blob" ? "Uint8Array"
    : logicalType === "json" ? "unknown"
    : "string";
  return nullable ? `${base} | null` : base;
}

export function generateModels(schema: OrmSchema): string {
  const imports = [
    "BaseEntity",
    "Column",
    "Entity",
    "PrimaryColumn",
    "PrimaryGeneratedColumn",
  ];
  const blocks = schema.entities.map((entity) => {
    const columns = entity.columns.map((column) => {
      const property = propertyName(column.propertyName || column.columnName);
      const decorator = column.primary && column.generated
        ? `@PrimaryGeneratedColumn("${column.generated}", ${JSON.stringify({
            name: column.columnName,
            type: column.logicalType,
          })})`
        : column.primary
          ? `@PrimaryColumn(${JSON.stringify({ name: column.columnName, type: column.logicalType })})`
          : `@Column(${JSON.stringify({
              name: column.columnName,
              type: column.logicalType,
              nullable: column.nullable,
              ...(column.length === undefined ? {} : { length: column.length }),
              ...(column.precision === undefined ? {} : { precision: column.precision }),
              ...(column.scale === undefined ? {} : { scale: column.scale }),
              ...(column.default === undefined ? {} : { default: column.default }),
            })})`;
      return `  ${decorator}\n  declare ${property}: ${tsType(column.logicalType, column.nullable)};`;
    }).join("\n\n");
    return `@Entity({ name: ${JSON.stringify(className(entity.modelName))}, tableName: ${JSON.stringify(entity.tableName)} })\n` +
      `export class ${className(entity.modelName)} extends BaseEntity {\n${columns}\n}`;
  });
  return `import { ${imports.join(", ")} } from "@cossackframework/database";\n\n${blocks.join("\n\n")}\n`;
}

export function generateMigration(
  name: string,
  operations: readonly SchemaOperation[],
  dialectName: "sqlite" | "postgres" | "mysql",
  options: {
    readonly downOperations?: readonly SchemaOperation[];
    readonly replaces?: readonly string[];
    readonly reversible?: boolean;
  } = {},
): string {
  const dialect = dialectFor(dialectName);
  const statements = operations.flatMap((operation) => renderOperation(operation, dialect));
  const downStatements = (options.downOperations ?? [])
    .flatMap((operation) => renderOperation(operation, dialect));
  const body = statements.length
    ? statements.map((statement) => `    schema.raw(sql.unsafe(${JSON.stringify(statement)}));`).join("\n")
    : "    // Schema is already up to date.";
  const downBody = options.reversible === false
    ? `    throw new Error("Squashed baseline migrations cannot be reverted automatically.");`
    : downStatements.length
      ? downStatements.map((statement) =>
          `    schema.raw(sql.unsafe(${JSON.stringify(statement)}));`).join("\n")
      : "    // Schema was already empty.";
  return `import { sql, type Migration } from "@cossackframework/database";\n\n` +
    `export default {\n` +
    `  name: ${JSON.stringify(name)},\n` +
    (options.replaces?.length
      ? `  replaces: ${JSON.stringify(options.replaces)},\n`
      : "") +
    `  async up({ schema }) {\n${body}\n  },\n` +
    `  async down({ schema }) {\n${downBody}\n` +
    `  },\n` +
    `} satisfies Migration;\n`;
}
