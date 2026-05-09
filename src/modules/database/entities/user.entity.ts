import { Column, CreateDateColumn, Entity, OneToMany, OneToOne } from 'typeorm';
import { UserKeyEntity } from './user-key.entity';
import { BalanceAccount } from './balance-account.entity';

@Entity({ name: 'users' })
export class UserEntity {
  @Column({ name: 'id', type: 'varchar', primary: true })
  readonly id: string;

  @Column({
    name: 'telegram_id',
    type: 'bigint',
    transformer: {
      to: (value: number) => value,
      from: (value: string) => Number(value),
    },
    nullable: true,
  })
  readonly telegramId?: number;

  @Column({ name: 'user_name', type: 'varchar', nullable: true })
  readonly userName?: string;

  @Column({
    name: 'language_code',
    type: 'varchar',
    length: 2 ** 4,
    default: 'en',
  })
  readonly languageCode: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  readonly createdAt: Date;

  @OneToMany(() => UserKeyEntity, (userKey) => userKey.user)
  readonly keys: UserKeyEntity[];

  @OneToOne(() => BalanceAccount, (balance) => balance.user)
  readonly balanceAccount: BalanceAccount;

  @Column({
    name: 'source',
    type: 'varchar',
    length: 2 ** 6,
    nullable: true,
  })
  readonly source?: string;
}
