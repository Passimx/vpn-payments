import { Check, Column, CreateDateColumn, Entity } from 'typeorm';

@Entity({ name: 'users' })
@Check('check_balance', 'balance >= 0')
export class UserEntity {
  @Column({ name: 'id', type: 'varchar', primary: true })
  readonly id: string;

  @Column({ name: 'balance', type: 'bigint', default: 0 })
  readonly balance: number;

  @Column({ name: 'telegram_id', type: 'bigint', nullable: true })
  readonly telegramId?: number;

  @CreateDateColumn({ name: 'created_at' })
  readonly createdAt: Date;
}
