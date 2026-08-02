import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  type Relation,
} from "../../../src/index.js";
import { Post } from "./Post.js";

@Entity()
export class User extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "varchar", unique: true })
  email!: string;

  @Column({ type: "varchar" })
  name!: string;

  @CreateDateColumn({ default: "CURRENT_TIMESTAMP" })
  createdAt!: Date;

  @UpdateDateColumn({ default: "CURRENT_TIMESTAMP" })
  updatedAt!: Date;

  @OneToMany(() => Post, (post) => post.author)
  posts!: Relation<Post[]>;
}
