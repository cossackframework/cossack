import "reflect-metadata";
import {
  BaseEntity,
  Column,
  Entity,
  PrimaryGeneratedColumn,
  createORM,
} from "@cossackframework/database";
import { nodeSQLite } from "@cossackframework/database/node";

@Entity()
class Note extends BaseEntity {
  @PrimaryGeneratedColumn()
  declare id: number;

  @Column()
  declare body: string;
}

const orm = createORM({
  adapter: await nodeSQLite({ filename: ":memory:" }),
  entities: [Note],
});

await orm.run(async () => {
  await Note.create({ body: "Request-scoped Active Record" }).save();
});

await orm.close();
