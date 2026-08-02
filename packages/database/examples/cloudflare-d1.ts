import {
  BaseEntity,
  Column,
  Entity,
  PrimaryGeneratedColumn,
  createORM,
} from "@cossackframework/database";
import {
  d1,
  type D1DatabaseBinding,
} from "@cossackframework/database/cloudflare";
import { ormMiddleware } from "@cossackframework/database/cossack";

@Entity()
class Message extends BaseEntity {
  @PrimaryGeneratedColumn()
  declare id: number;

  @Column()
  declare body: string;
}

export async function createRequestMiddleware(database: D1DatabaseBinding) {
  const orm = createORM({
    adapter: await d1(database),
    entities: [Message],
  });
  return ormMiddleware(orm);
}
