import type { QueryResult } from "../adapter/types.js";
import type { BaseEntity } from "./base-entity.js";
import type { EntityMetadata, EntityTarget } from "../metadata/types.js";
import type { ORM } from "../orm.js";
import { MutationQueryBuilder, SelectQueryBuilder } from "../query/builder.js";
import type { EntityShape, FindOptions, FindWhere, OrderDirection } from "../query/types.js";

export class ModelManager<T extends BaseEntity> {
  constructor(
    readonly orm: ORM,
    readonly target: EntityTarget<T>,
    readonly metadata: EntityMetadata,
  ) {}

  create(values: Partial<EntityShape<T>> = {}): T {
    const entity = new this.target() as T;
    Object.assign(entity, values);
    this.orm.markNew(entity, this.metadata);
    return entity;
  }

  query(alias?: string): SelectQueryBuilder<T> {
    return new SelectQueryBuilder<T>(this.orm, this.metadata, alias);
  }

  async find(options: FindOptions<T> = {}): Promise<readonly T[]> {
    const builder = this.query();
    if (options.select) builder.select(...options.select);
    if (options.where) builder.where(options.where);
    for (const [property, direction] of Object.entries(options.order ?? {})) {
      if (direction) builder.orderBy(
        property as keyof EntityShape<T> & string,
        direction as OrderDirection,
      );
    }
    if (options.take !== undefined) builder.limit(options.take);
    if (options.skip !== undefined) builder.offset(options.skip);
    const entities = await builder.getMany();
    const relations = options.relations ?? options.with;
    if (relations?.length) await this.orm.loadRelations(entities, this.metadata, relations);
    return entities;
  }

  async findOne(options: FindOptions<T>): Promise<T | null> {
    const values = await this.find({ ...options, take: 1 });
    return values[0] ?? null;
  }

  findBy(where: FindWhere<T>): Promise<readonly T[]> {
    return this.find({ where });
  }

  count(where?: FindWhere<T>): Promise<number> {
    const builder = this.query();
    if (where) builder.where(where);
    return builder.count();
  }

  exists(where?: FindWhere<T>): Promise<boolean> {
    const builder = this.query();
    if (where) builder.where(where);
    return builder.exists();
  }

  insert(values: Partial<EntityShape<T>> | readonly Partial<EntityShape<T>>[]): Promise<QueryResult> {
    return this.insertQuery(values).execute();
  }

  insertQuery(values: Partial<EntityShape<T>> | readonly Partial<EntityShape<T>>[]): MutationQueryBuilder<T> {
    return new MutationQueryBuilder(this.orm, this.metadata, "insert", Array.isArray(values) ? values : [values]);
  }

  upsert(
    values: Partial<EntityShape<T>> | readonly Partial<EntityShape<T>>[],
    conflict: readonly (keyof EntityShape<T> & string)[],
  ): Promise<QueryResult> {
    return new MutationQueryBuilder(
      this.orm,
      this.metadata,
      "upsert",
      Array.isArray(values) ? values : [values],
      undefined,
      conflict,
    ).execute();
  }

  update(where: FindWhere<T>, values: Partial<EntityShape<T>>): Promise<QueryResult> {
    return new MutationQueryBuilder(this.orm, this.metadata, "update", [values], where).execute();
  }

  delete(where: FindWhere<T>): Promise<QueryResult> {
    return new MutationQueryBuilder(this.orm, this.metadata, "delete", undefined, where).execute();
  }
}
