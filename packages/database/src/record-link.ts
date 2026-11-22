const RECORD_LINK = Symbol.for("@cossackframework/database/record-link");

export type RecordKey = string | number | bigint;

/**
 * A link to one record of a document table: the table and the record's key. Document
 * entities store their `id` and their links to other document entities this way. The
 * RomeDB driver sends it as RomeDB's own record value and reads that value back as a link.
 */
export class RecordLink {
  readonly [RECORD_LINK] = true;

  constructor(readonly table: string, readonly key: RecordKey) {
    if (!table) throw new TypeError("A record link requires a table name.");
    if (key === undefined || key === null || key === "") throw new TypeError(`A record link to ${table} requires a key.`);
    Object.freeze(this);
  }

  toString(): string {
    return `${this.table}:${String(this.key)}`;
  }

  toJSON(): string {
    return this.toString();
  }
}

export function isRecordLink(value: unknown): value is RecordLink {
  return typeof value === "object" && value !== null && RECORD_LINK in value;
}
