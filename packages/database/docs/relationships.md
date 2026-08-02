---
title: Relationships
description: Define, persist, and explicitly load one-to-one, one-to-many, many-to-one, and many-to-many relations.
---

# Relationships

Relations describe links between registered entities. They are explicit:
Cossack ORM does not lazy-load a property when it is accessed. Request the
relations needed by a query with `relations` or `with`.

## One-to-many and many-to-one

A post owns the foreign key to its author:

```ts
// User.ts
import {
  BaseEntity,
  Column,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
} from "@cossackframework/database";
import { Post } from "./Post.js";

@Entity()
export class User extends BaseEntity {
  @PrimaryGeneratedColumn()
  declare id: number;

  @Column()
  declare name: string;

  @OneToMany(() => Post, (post) => post.author)
  declare posts: Relation<Post[]>;
}
```

```ts
// Post.ts
import {
  BaseEntity,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from "@cossackframework/database";
import { User } from "./User.js";

@Entity()
export class Post extends BaseEntity {
  @PrimaryGeneratedColumn()
  declare id: number;

  @Column()
  declare title: string;

  @Column({ name: "author_id", type: "integer" })
  declare authorId: number;

  @ManyToOne(() => User, (user) => user.posts, {
    nullable: false,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "author_id", referencedColumnName: "id" })
  declare author: Relation<User>;
}
```

Keep the physical foreign-key column as a decorated property when application
code needs to query or assign it directly. Assigning the owning relation also
synchronizes that property before persistence:

```ts
await orm.run(async () => {
  const user = User.create({ name: "Ada Lovelace" });
  await user.save();

  const post = Post.create({ title: "Poetical Science" });
  post.author = user;
  await post.save();
});
```

## Loading relations

```ts
const users = await User.find({
  relations: ["posts"],
  order: { name: "asc" },
});

const posts = await Post.find({
  with: ["author"],
});
```

`relations` and `with` are aliases. The loader collects relation keys and
fetches related rows in batches, chunked according to the adapter parameter
limit. This avoids issuing one query per parent row.

Relations are not recursive by default. Request only the relation properties
needed by the operation.

## One-to-one

Place `@JoinColumn()` on the owning side:

```ts
@Entity()
class UserProfile extends BaseEntity {
  @PrimaryGeneratedColumn()
  declare id: number;

  @Column("text")
  declare biography: string;

  @OneToOne(() => User, (user) => user.profile, {
    nullable: false,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "user_id", referencedColumnName: "id" })
  declare user: Relation<User>;
}

@Entity()
class User extends BaseEntity {
  @PrimaryGeneratedColumn()
  declare id: number;

  @OneToOne(() => UserProfile, (profile) => profile.user)
  declare profile: Relation<UserProfile>;
}
```

## Many-to-many

Put `@JoinTable()` on exactly one side:

```ts
@Entity()
class User extends BaseEntity {
  @PrimaryGeneratedColumn()
  declare id: number;

  @ManyToMany(() => Role, (role) => role.users, {
    cascade: ["insert", "update"],
  })
  @JoinTable({
    name: "user_roles",
    joinColumn: {
      name: "user_id",
      referencedColumnName: "id",
    },
    inverseJoinColumn: {
      name: "role_id",
      referencedColumnName: "id",
    },
  })
  declare roles: Relation<Role[]>;
}

@Entity()
class Role extends BaseEntity {
  @PrimaryGeneratedColumn()
  declare id: number;

  @Column({ unique: true })
  declare name: string;

  @ManyToMany(() => User, (user) => user.roles)
  declare users: Relation<User[]>;
}
```

Join-table synchronization occurs on the owning side when the relation opts into
the relevant insert/update cascade.

## Cascades

Cascades are disabled by default:

```ts
@OneToMany(() => Post, (post) => post.author, {
  cascade: ["insert", "update"],
})
declare posts: Relation<Post[]>;
```

`cascade: true` enables both insert and update cascades. Prefer the explicit
array in reusable packages so the persistence behavior is visible.

Delete cascades are database behavior configured with `onDelete`. Cossack ORM
does not walk an in-memory object graph and delete related entities.

## Nullable and logical relations

Use `nullable` to describe whether an owning relation may be absent:

```ts
@ManyToOne(() => Team, (team) => team.members, {
  nullable: true,
})
@JoinColumn({ name: "team_id" })
declare team: Relation<Team | null>;
```

Set `createForeignKeyConstraints: false` for a logical relation that should
appear in ORM metadata without creating a database foreign-key constraint:

```ts
@ManyToOne(() => ExternalAccount, {
  createForeignKeyConstraints: false,
})
@JoinColumn({ name: "external_account_id" })
declare externalAccount: Relation<ExternalAccount>;
```

Logical and physical relation provenance is included in `orm.schema()` for
Studio and other tooling.

## Registration and circular imports

Relation targets are callbacks so circular model references resolve after class
evaluation:

```ts
@ManyToOne(() => User, (user) => user.posts)
declare author: Relation<User>;
```

Still register every target:

```ts
export const entities = [User, Post, Role, UserProfile] as const;
```

ORM creation validates missing targets, invalid inverse properties, and
unresolved join metadata.
