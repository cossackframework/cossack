import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  type Relation,
} from "../../../src/index.js";
import { User } from "./User.js";

@Entity()
@Index("idx_posts_created_at", ["createdAt"])
export class Post extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "varchar", unique: true })
  slug!: string;

  @Column({ type: "varchar" })
  title!: string;

  @Column({ type: "text", nullable: true })
  body!: string | null;

  @Column({ type: "boolean", default: false })
  published!: boolean;

  @CreateDateColumn({ default: "CURRENT_TIMESTAMP" })
  createdAt!: Date;

  @UpdateDateColumn({ default: "CURRENT_TIMESTAMP" })
  updatedAt!: Date;

  @Column({ name: "author_id", type: "integer" })
  @Index("idx_posts_author_id")
  authorId!: number;

  @ManyToOne(() => User, (user) => user.posts, {
    nullable: false,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "author_id", referencedColumnName: "id" })
  author!: Relation<User>;
}
