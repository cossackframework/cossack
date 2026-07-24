import { quoteIdentifier, sqliteAffinity, sqliteDeclaredKind } from './sql.js';
import type {
  StudioColumn,
  StudioConnection,
  StudioIndex,
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

interface PragmaIndex {
  name: string;
  unique?: number;
  origin?: string;
  partial?: number;
}

interface PragmaIndexColumn {
  seqno?: number;
  name?: string | null;
  desc?: number;
  coll?: string | null;
  key?: number;
}

function editableReason(kind: 'table' | 'view', columns: StudioColumn[]): string | undefined {
  if (kind === 'view') return 'Views are read-only.';
  if (!columns.some((column) => column.primaryKeyPosition > 0)) {
    return 'This table has no declared primary key.';
  }
  return undefined;
}

export async function introspectSchema(
  connection: StudioConnection,
  applicationName = 'Cossack application',
): Promise<StudioSchema> {
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
        declaredKind: sqliteDeclaredKind(dataType),
        nullable: !column.notnull && primaryKeyPosition === 0,
        defaultValue: column.dflt_value ?? null,
        primaryKeyPosition,
        autoIncrement: primaryKeyPosition > 0 &&
          /\bAUTOINCREMENT\b/i.test(definition) &&
          sqliteAffinity(dataType) === 'integer',
        hidden: Number(column.hidden ?? 0) !== 0,
      };
    });
    const indexes: StudioIndex[] = [];
    if (row.type === 'table') {
      const indexList = await connection.execute(`PRAGMA index_list(${quoteIdentifier(row.name)})`);
      for (const index of indexList.rows as unknown as PragmaIndex[]) {
        const indexInfo = await connection.execute(`PRAGMA index_xinfo(${quoteIdentifier(index.name)})`);
        indexes.push({
          name: index.name,
          unique: Number(index.unique ?? 0) !== 0,
          origin: index.origin ?? 'c',
          partial: Number(index.partial ?? 0) !== 0,
          columns: (indexInfo.rows as unknown as PragmaIndexColumn[])
            .filter((column) => Number(column.key ?? 1) !== 0)
            .map((column) => ({
              name: column.name ?? null,
              position: Number(column.seqno ?? 0),
              descending: Number(column.desc ?? 0) !== 0,
              collation: column.coll ?? null,
            })),
        });
      }
    }
    const reason = editableReason(row.type, columns);
    objects.push({
      name: row.name,
      kind: row.type,
      sql: row.sql,
      columns,
      indexes,
      editable: reason === undefined,
      readOnlyReason: reason,
    });
  }
  return { connection: connection.info, applicationName, objects };
}

export function findObject(schema: StudioSchema, name: string): StudioObject {
  const object = schema.objects.find((candidate) => candidate.name === name);
  if (!object) throw new Error(`Table or view "${name}" does not exist.`);
  return object;
}
