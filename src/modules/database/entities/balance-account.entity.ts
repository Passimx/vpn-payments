import { Check, Column, Entity, JoinColumn, OneToOne } from 'typeorm';
import { UserEntity } from './user.entity';

@Entity({ name: 'balance_account' })
@Check('check_balance', 'rub >= 0 AND cny >= 0 AND ton >= 0 AND ton_usdt >= 0')
export class BalanceAccount {
  @Column({ name: 'user_id', type: 'varchar', primary: true })
  readonly userId: string;

  @Column({
    name: 'rub',
    type: 'numeric',
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => Number(value),
    },
  })
  rub: number;

  @Column({
    name: 'cny',
    type: 'numeric',
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => Number(value),
    },
  })
  cny: number;

  @Column({
    name: 'ton',
    type: 'numeric',
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => Number(value),
    },
  })
  ton: number;

  @Column({
    name: 'usd',
    type: 'numeric',
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => Number(value),
    },
  })
  usd: number;

  @OneToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  readonly user: UserEntity;
}
