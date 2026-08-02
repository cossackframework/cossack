import "reflect-metadata";
import {
  BaseEntity,
  Column,
  Entity,
  PrimaryGeneratedColumn,
  defineConfig,
} from "@cossackframework/database";
import { MemoryDriver } from "@cossackframework/database/adapter";

@Entity()
class CliEntity extends BaseEntity {
  @PrimaryGeneratedColumn()
  declare id: number;

  @Column("varchar")
  declare name: string;
}

export default defineConfig({
  adapter: { driver: new MemoryDriver() },
  entities: [CliEntity],
});
