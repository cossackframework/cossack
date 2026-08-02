import { BaseEntity, Column, Entity, PrimaryGeneratedColumn, createORM } from "@cossackframework/database";
import { bun } from "@cossackframework/database/bun";

@Entity()
class Event extends BaseEntity {
  @PrimaryGeneratedColumn()
  declare id: number;

  @Column()
  declare name: string;
}

const orm = createORM({
  adapter: bun({ url: "sqlite://events.db", dialect: "sqlite" }),
  entities: [Event],
});

await orm.run(() => Event.find());
