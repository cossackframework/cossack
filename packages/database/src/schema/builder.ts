import type { ORM } from "../orm.js";
import { dialectFor } from "../dialect/dialects.js";
import type { SchemaOperation } from "./operations.js";
import { renderOperation } from "./ddl.js";
import type { EntitySchema } from "./types.js";
import { SQLFragment } from "../sql/fragment.js";

export class SchemaBuilder {
  private readonly queue: (SchemaOperation | SQLFragment)[] = [];

  createTable(entity: EntitySchema): this {
    this.queue.push({ kind: "create-table", entity });
    return this;
  }

  dropTable(tableName: string): this {
    this.queue.push({ kind: "drop-table", tableName });
    return this;
  }

  renameTable(from: string, to: string): this {
    this.queue.push({ kind: "rename-table", from, to });
    return this;
  }

  addColumn(tableName: string, column: EntitySchema["columns"][number]): this {
    this.queue.push({ kind: "add-column", tableName, column });
    return this;
  }

  dropColumn(tableName: string, columnName: string): this {
    this.queue.push({ kind: "drop-column", tableName, columnName });
    return this;
  }

  raw(fragment: SQLFragment): this {
    this.queue.push(fragment);
    return this;
  }

  operations(): readonly (SchemaOperation | SQLFragment)[] {
    return Object.freeze([...this.queue]);
  }

  async execute(orm: ORM): Promise<void> {
    const dialect = dialectFor(orm.driver.dialect);
    for (const item of this.queue) {
      if (!(item instanceof SQLFragment)) {
        for (const statement of renderOperation(item as SchemaOperation, dialect)) {
          await orm.executeFragment(orm.sql.unsafe(statement), "ddl");
        }
      } else {
        await orm.executeFragment(item as SQLFragment, "ddl");
      }
    }
  }
}
