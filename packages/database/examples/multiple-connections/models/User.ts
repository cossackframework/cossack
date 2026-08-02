import {
  BaseEntity,
  Column,
  Entity,
  PrimaryGeneratedColumn,
} from "../../../src/index.js";

@Entity()
export class User extends BaseEntity {
  @PrimaryGeneratedColumn()
  declare id: number;

  @Column({ type: "varchar", unique: true })
  declare email: string;

  @Column({ type: "varchar" })
  declare name: string;
}
