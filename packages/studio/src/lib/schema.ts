import { quoteIdentifier, sqliteAffinity } from './sql.js';
import type {
  StudioColumn,
  StudioConnection,
  StudioObject,
  StudioSchema,
} from './types.js';

interface SchemaRow {
  name: string;
  type: 'table' | 'view';
  sql: string | null;
}

interface PragmaColumn {
  name: string;
  type?: string;
  notnull?: number;
  dflt_value?: string | null;
  pk?: number;
  hidden?: number;
}

function editableReason(kind: 'table' | 'view', columns: StudioColumn[]): string | undefined {
  if (kind === 'view') return 'Views are read-only.';
  if (!columns.some((column) => column.primaryKeyPosition > 0)) {
    return 'This table has no declared primary key.';
  }
  return undefined;
}

export async function introspectSchema(connection: StudioConnection): Promise<StudioSchema> {
  const result = await connection.execute(`
    SELECT name, type, sql
    FROM sqlite_schema
    WHERE type IN ('table', 'view')
      AND name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `);
  const rows = result.rows as unknown as SchemaRow[];
  const objects: StudioObject[] = [];
  for (const row of rows) {
    const pragma = await connection.execute(`PRAGMA table_xinfo(${quoteIdentifier(row.name)})`);
    const definition = row.sql ?? '';
    const columns = (pragma.rows as unknown as PragmaColumn[]).map((column) => {
      const dataType = column.type ?? '';
      const primaryKeyPosition = Number(column.pk ?? 0);
      return {
        name: column.name,
        dataType,
        affinity: sqliteAffinity(dataType),
        nullable: !column.notnull && primaryKeyPosition === 0,
        defaultValue: column.dflt_value ?? null,
        primaryKeyPosition,
        autoIncrement: primaryKeyPosition > 0 &&
          /\bAUTOINCREMENT\b/i.test(definition) &&
          sqliteAffinity(dataType) === 'integer',
        hidden: Number(column.hidden ?? 0) !== 0,
      };
    });
    const reason = editableReason(row.type, columns);
    objects.push({
      name: row.name,
      kind: row.type,
      sql: row.sql,
      columns,
      editable: reason === undefined,
      readOnlyReason: reason,
    });
  }
  return { connection: connection.info, objects };
}

export function findObject(schema: StudioSchema, name: string): StudioObject {
  const object = schema.objects.find((candidate) => candidate.name === name);
  if (!object) throw new Error(`Table or view "${name}" does not exist.`);
  return object;
}
