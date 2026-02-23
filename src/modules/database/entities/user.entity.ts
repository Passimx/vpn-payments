import { Check, Column, CreateDateColumn, Entity } from 'typeorm';

@Entity({ name: 'users' })
@Check('check_balance', 'balance >= 0')
export class UserEntity {
  @Column({ name: 'id', type: 'varchar', primary: true })
  readonly id: string;

  @Column({
    name: 'balance',
    type: 'bigint',
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => Number(value),
    },
  })
  readonly balance: number;

  @Column({
    name: 'telegram_id',
    type: 'bigint',
    nullable: true,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => Number(value),
    },
  })
  readonly telegramId?: number;

  @Column({
    name: 'userName',
    type: 'varchar',
    nullable: true,
  })
  userName?: string;

  @CreateDateColumn({ name: 'created_at' })
  readonly createdAt: Date;
}
