import "reflect-metadata";
import {
  BaseEntity,
  Entity,
  PrimaryGeneratedColumn,
  defineConfig,
} from "../../src/index.js";
import { MemoryDriver } from "../../src/adapter/index.js";

@Entity()
class CliEntity extends BaseEntity {
  @PrimaryGeneratedColumn()
  declare id: number;
}

export default defineConfig({
  adapter: { driver: new MemoryDriver() },
  entities: [CliEntity],
});
