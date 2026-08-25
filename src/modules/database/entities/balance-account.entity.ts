import { Check, Column, Entity, Index, JoinColumn, OneToOne } from 'typeorm';
import { UserEntity } from './user.entity';

export const scale = 5;
export const precision = 12;

@Entity({ name: 'balance_account' })
@Check('check_balance', 'rub >= 0 AND cny >= 0 AND ton >= 0 AND usd >= 0')
@Index(['userId'])
export class BalanceAccount {
  @Column({ name: 'user_id', type: 'varchar', primary: true })
  readonly userId: string;

  @Column({
    name: 'rub',
    type: 'numeric',
    precision,
    scale,
    default: 0,
    transformer: {
      to: (value?: number) => {
        if (value === undefined || value === null || Number.isNaN(value))
          return 0;
        return Math.floor(value * 10 ** scale) / 10 ** scale;
      },
      from: (value: string) => Number(value),
    },
  })
  rub: number;

  @Column({
    name: 'cny',
    type: 'numeric',
    precision,
    scale,
    default: 0,
    transformer: {
      to: (value?: number) => {
        if (value === undefined || value === null || Number.isNaN(value))
          return 0;
        return Math.floor(value * 10 ** scale) / 10 ** scale;
      },
      from: (value: string) => Number(value),
    },
  })
  cny: number;

  @Column({
    name: 'ton',
    type: 'numeric',
    precision,
    scale,
    default: 0,
    transformer: {
      to: (value?: number) => {
        if (value === undefined || value === null || Number.isNaN(value))
          return 0;
        return Math.floor(value * 10 ** scale) / 10 ** scale;
      },
      from: (value: string) => Number(value),
    },
  })
  ton: number;

  @Column({
    name: 'usd',
    type: 'numeric',
    precision,
    scale,
    default: 0,
    transformer: {
      to: (value?: number) => {
        if (value === undefined || value === null || Number.isNaN(value))
          return 0;
        return Math.floor(value * 10 ** scale) / 10 ** scale;
      },
      from: (value: string) => Number(value),
    },
  })
  usd: number;

  @Column({ name: 'seqno', default: 1 })
  seqno: number;

  @OneToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  readonly user: UserEntity;
}
