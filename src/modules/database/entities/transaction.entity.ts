import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { UserEntity } from './user.entity';

@Entity({ name: 'transactions' })
export class TransactionEntity {
  @Column({ name: 'id', type: 'bigint', primary: true })
  readonly id: bigint;

  @Column({ name: 'balance', type: 'numeric', default: 0 })
  readonly amount: number;

  @Column({ name: 'currency', type: 'varchar', default: 2 ** 8 })
  readonly currency: 'TON' | 'USD' | 'РУБ';

  @Column({ name: 'message', type: 'text', nullable: true })
  readonly message: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  readonly userId: string;

  @Column({
    name: 'created_at',
    type: 'bigint',
    transformer: {
      to: (value: number) => value,
      from: (value: string) => Number(value),
    },
  })
  readonly createdAt: number;

  // Credit - деньги пришли
  // Debit - деньги ушли
  @Column({ name: 'type', type: 'varchar', nullable: true, length: 2 ** 4 })
  readonly type: 'Credit' | 'Debit';

  @Column({ name: 'place', type: 'varchar', length: 2 ** 4 })
  readonly place: 'ton' | 't_bank';

  @Column({ name: 'completed', type: 'boolean', default: false })
  readonly completed: boolean;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  readonly user: UserEntity;
}
