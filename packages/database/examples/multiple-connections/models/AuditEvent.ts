import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from "../../../src/index.js";

@Entity()
export class AuditEvent extends BaseEntity {
  @PrimaryGeneratedColumn()
  declare id: number;

  @Column({ type: "varchar", unique: true })
  declare eventKey: string;

  @Column({ type: "varchar" })
  declare userEmail: string;

  @Column({ type: "varchar" })
  declare action: string;

  @CreateDateColumn({ default: "CURRENT_TIMESTAMP" })
  declare createdAt: Date;
}
