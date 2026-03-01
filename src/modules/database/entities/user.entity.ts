import { Check, Column, CreateDateColumn, Entity, OneToMany } from 'typeorm';
import { UserKeyEntity } from './user-key.entity';

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
    name: 'chat_id',
    type: 'bigint',
    transformer: {
      to: (value: number) => value,
      from: (value: string) => Number(value),
    },
  })
  readonly chatId?: number;

  @Column({
    name: 'user_name',
    type: 'varchar',
    nullable: true,
  })
  readonly userName?: string;

  @CreateDateColumn({ name: 'created_at' })
  readonly createdAt: Date;

  @OneToMany(() => UserKeyEntity, (userKey) => userKey.user)
  readonly keys: UserKeyEntity[];
}
