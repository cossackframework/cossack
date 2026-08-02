import "reflect-metadata";
import {
  BaseEntity,
  Column,
  Entity,
  PrimaryGeneratedColumn,
  defineConfig,
} from "../../src/index.js";
import { MemoryDriver } from "../../src/adapter/index.js";

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
  migrations: [{
    name: "0001_old",
    up() {},
    down() {},
  }],
});
