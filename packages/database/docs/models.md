---
title: Models
description: Define decorated Active Record models, columns, keys, indexes, timestamps, and hooks.
---

# Models

A model is a decorated class extending `BaseEntity`. Decorators describe its
logical schema; `BaseEntity` supplies static query methods and instance
persistence methods.

```ts
import {
  BaseEntity,
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "@cossackframework/database";

@Entity()
@Index("idx_users_name", ["name"])
export class User extends BaseEntity {
  @PrimaryGeneratedColumn()
  declare id: number;

  @Column({ unique: true })
  declare email: string;

  @Column()
  declare name: string;

  @Column({ type: "json", nullable: true })
  declare preferences: Record<string, unknown> | null;

  @CreateDateColumn({ default: "CURRENT_TIMESTAMP" })
  declare createdAt: Date;

  @UpdateDateColumn({ default: "CURRENT_TIMESTAMP" })
  declare updatedAt: Date;

  @BeforeInsert()
  normalizeEmail() {
    this.email = this.email.trim().toLowerCase();
  }
}
```

## Naming

The default naming strategy:

- Converts entity names to plural `snake_case` table names.
- Converts properties to `snake_case` columns.
- Builds relation and join-table names from those physical names.

`UserProfile` therefore maps to `user_profiles`, and `createdAt` maps to
`created_at`.

Override physical names when needed:

```ts
@Entity({ name: "Account", tableName: "legacy_accounts" })
class User extends BaseEntity {
  @PrimaryColumn({ name: "account_id", type: "uuid" })
  declare id: string;

  @Column({ name: "display_name" })
  declare name: string;
}
```

`name` is the logical model name; `tableName` is the database table.

## Column types

When reflection is available, `@Column()` safely infers:

| TypeScript design type | Logical type |
| --- | --- |
| `String` | `varchar(255)` |
| `Number` | `integer` |
| `Boolean` | `boolean` |
| `Date` | `datetime` |
| `Uint8Array` or `ArrayBuffer` | `blob` |

Values that lose information through reflection require an explicit type:

```ts
@Column({ type: "decimal", precision: 12, scale: 2 })
declare total: string;

@Column({ type: "enum", enum: ["draft", "published"] })
declare status: "draft" | "published";

@Column({ type: "json" })
declare metadata: Record<string, unknown>;

@Column({ type: "custom:geography", name: "location" })
declare location: unknown;
```

Supported logical types are `varchar`, `text`, `integer`, `bigint`, `decimal`,
`boolean`, `datetime`, `date`, `json`, `enum`, `blob`, `uuid`, and
`custom:<database-type>`.

Common column options include:

```ts
@Column({
  name: "external_id",
  type: "varchar",
  length: 64,
  nullable: false,
  unique: true,
  insert: true,
  update: false,
  select: true,
})
declare externalId: string;
```

Use `renamedFrom` when a model property maps to a renamed database column.
Migration generation never guesses renames heuristically.

## Primary and generated columns

```ts
@PrimaryGeneratedColumn()              // incrementing integer
declare id: number;

@PrimaryGeneratedColumn("identity")    // SQL identity where supported
declare id: number;

@PrimaryGeneratedColumn("uuid")
declare id: string;
```

For application-assigned or composite keys, use `@PrimaryColumn()`:

```ts
@Entity()
class Translation extends BaseEntity {
  @PrimaryColumn()
  declare articleId: number;

  @PrimaryColumn()
  declare locale: string;

  @Column("text")
  declare body: string;
}
```

Generated columns cannot participate in a composite primary key.

## Indexes and unique constraints

Decorate one property:

```ts
@Index("idx_posts_created_at")
@Column({ type: "datetime" })
declare createdAt: Date;
```

Or decorate the class for compound indexes:

```ts
@Entity()
@Index("idx_posts_author_status", ["authorId", "status"])
@Unique("uq_posts_author_slug", ["authorId", "slug"])
class Post extends BaseEntity {
  // ...
}
```

## Timestamps, versions, and soft deletion

Special columns participate in persistence hooks:

```ts
@CreateDateColumn()
declare createdAt: Date;

@UpdateDateColumn()
declare updatedAt: Date;

@DeleteDateColumn()
declare deletedAt: Date | null;

@VersionColumn()
declare version: number;
```

`save()` fills create/update timestamps and increments version columns.
Optimistic updates fail when the stored version changed. `remove()` writes the
delete timestamp when a `@DeleteDateColumn()` exists; otherwise it deletes the
row. Queries do not implicitly hide timestamped rows, so add an explicit
`deletedAt: null` predicate when that is the desired application policy.

## Creating and saving entities

```ts
await orm.run(async () => {
  const user = User.create({
    email: "ada@example.com",
    name: "Ada Lovelace",
  });

  await user.save();

  user.name = "Augusta Ada King";
  await user.save(); // updates only changed persisted fields

  await user.reload();
  await user.remove();
});
```

Hydrated entities retain an original snapshot. Existing entities update only
changed persisted fields; new entities are inserted.

## Lifecycle hooks

Available hook decorators are:

- `@BeforeInsert()` and `@AfterInsert()`
- `@BeforeUpdate()` and `@AfterUpdate()`
- `@BeforeRemove()` and `@AfterRemove()`
- `@AfterLoad()`

Hooks may be synchronous or asynchronous. Keep database side effects deliberate:
a hook runs as part of the surrounding save/remove operation and uses the
current ORM or transaction scope.

Continue with [Queries](./queries.md) and
[Relationships](./relationships.md).
