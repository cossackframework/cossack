---
title: RomeDB
description: Use RomeDB as an ORM database, with relational entities, document entities, record links, and the RomeDB instance for RomeQL.
---

# RomeDB

RomeDB is a multi-model database with a SQLite-compatible relational model. The ORM runs on
it through an adapter, so the same entities, queries, migrations and seeders work as on
SQLite. RomeDB also stores documents, and an entity can be a document.

```ts
import { createORM } from "@cossackframework/database";
import { createRomeDB } from "@cossackframework/romedb";
import { connectNode, FilePendingWriteStore } from "@cossackframework/romedb/node";
import { romedb } from "@cossackframework/romedb/orm";

const url = "storage/romedb/app.romedb";
const db = createRomeDB({
  url,
  connect: () => connectNode({ url }),
  pending: new FilePendingWriteStore(".cossack/romedb-pending"),
});

const orm = createORM({ adapter: await romedb(db), entities });
```

On Workers, create the instance with `url`, `token` and a `DurableObjectPendingWriteStore`
(see the `@cossackframework/romedb` README). The RomeDB instance is yours: `orm.close()`
leaves it open, so other code can keep using it. Close it yourself when the process ends.

## What the adapter does

- A query (`SELECT`, `WITH`, `INFO`) is one read. Every other statement is one write.
- A write goes through `RomeDB.write`, so it is saved before it is sent and can be recovered.
  A write that loses to a concurrent write of the same rows runs again, up to five times
  (`retryConflicts` in the adapter's options).
- A batch is one atomic write of at most 32 statements. Migrations run as one batch: the
  schema changes and the migration's record apply together or not at all.
- There are no interactive transactions. `orm.transaction()` throws
  `UnsupportedCapabilityError`, as on D1.
- `RETURNING` is supported, so `save()` reads back the database's defaults.
- The schema is read with `INFO FOR` and the stored DDL text. `orm.introspect()` and the
  drift check work.

| Limit | Value |
| --- | --- |
| Statements in one batch | 32 |
| Parameters in one statement | 500 |
| Request size | 64 KiB on an engine that reports none; see the RomeDB package |

## Document entities

Set `model: "document"` to store an entity in a RomeDB document table.

```ts
@Entity({ tableName: "people", model: "document" })
@Index(["profile.city"])
class Person extends BaseEntity {
  @PrimaryGeneratedColumn("uuid") declare id: string;
  @Column({ type: "varchar", unique: true }) declare handle: string;
  @Column({ type: "boolean" }) declare active: boolean;
  @Column({ type: "json", nullable: true }) declare profile: { city: string; tags: string[] } | null;
}
```

The API is the same as for a relational entity: `find`, `findOne`, `count`, `insert`,
`update`, `upsert`, `delete`, `save`, `remove`, relations and the query builder. These
things differ:

- **Fields keep their types.** A boolean is stored as a boolean and a `json` column as a
  nested object or array, not as text.
- **The primary column is the record's `id`.** There is exactly one, stored as `id`. Use
  `@PrimaryGeneratedColumn("uuid")`, or `@PrimaryColumn()` with your own key. A counter
  (`increment`) is not available. In the entity the value is the key (`"ada"`); in the
  database it is the record `people:ada`.
- **The table has no columns.** Its DDL is `CREATE TABLE "people"` and its indexes. Adding
  or removing a column needs no migration. A `unique` column is a unique index.
- **A field that is not set is left out.** Reading it gives `null`.
- **An index can name a nested field**, written as a path: `@Index(["profile.city"])`.
- **A table does not change its model.** To turn a relational table into a document table,
  create a table under a new name and copy the data.

To filter on a nested field, write the path with `sql.id()`:

```ts
const people = await Person.query("p")
  .where(sql.fragment`${sql.id("p", "profile", "city")} = ${"Paris"}`)
  .getMany();
```

Document entities need RomeDB. Another adapter refuses them when the ORM is created.

## Record links

A relation between two document entities is stored as a RomeDB record link.

```ts
@Entity({ tableName: "articles", model: "document" })
class Article extends BaseEntity {
  @PrimaryColumn({ type: "varchar" }) declare id: string;
  @ManyToOne(() => Person, person => person.articles) declare author: Relation<Person>;
  declare authorId: string;
}
```

`authorId` is the key in the entity and the record `people:<key>` in the database. Load the
relation as usual: `Article.find({ relations: ["author"] })`. In RomeQL the link is a link:
`record::fetch(author_id)` gives the author's document.

A relation between a document entity and a relational entity keeps the other row's key as a
plain value, in either direction. No foreign key constraint is made for it, because a
constraint cannot name a document table. A many-to-many relation uses a relational join
table that holds the keys.

`RecordLink` is the ORM's value for a link. Pass one to the `sql` tag to compare with a
link, and expect one for a record in a raw result:

```ts
import { RecordLink } from "@cossackframework/database";

const rows = await orm.sql`SELECT d.title FROM articles AS d WHERE d.author_id = ${new RecordLink("people", "ada")}`;
```

## RomeQL the ORM does not write

`romedbClient()` gives the RomeDB instance the ORM runs on. Use it for graph traversal,
vectors, search and any other RomeQL. The calls share the ORM's connection, its
pending-write store and its limits.

```ts
import { romedbClient } from "@cossackframework/romedb/orm";

const db = romedbClient();          // the ORM of the current request
const result = await db.read([{
  rql: "SELECT g.node FROM GRAPH(people:ada -> follows -> people) AS g",
}]);
```

Pass an ORM (`romedbClient(orm)`) outside a request scope.

## Known limits

- A graph edge joins two document tables. A relational row cannot be the end of an edge,
  and `record::fetch` does not follow a link to a relational row.
- RomeDB refuses `null` in a field that is the parent of an indexed nested field
  (`profile` with an index on `profile.city`). Inserts leave unset fields out, so this
  applies only to an update that sets such a field to `null`.
- One process owns a RomeDB file. Run migrations and Studio against a file only while the
  application is stopped, or share the database through `romedb serve`.
