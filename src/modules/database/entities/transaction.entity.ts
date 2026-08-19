import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
} from 'typeorm';
import { UserEntity } from './user.entity';
import { type CurrencyEnum } from '../../transactions/types/currency.enum';

@Entity({ name: 'transactions' })
export class TransactionEntity {
  @Column({ name: 'id', type: 'bigint', primary: true })
  readonly id: bigint;

  @Column({ name: 'amount', type: 'numeric', default: 0 })
  readonly amount: number;

  @Column({ name: 'currency', type: 'varchar' })
  readonly currency: CurrencyEnum;

  @Column({ name: 'user_id', type: 'uuid' })
  readonly userId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  readonly createdAt: Date;

  // Credit - деньги пришли
  // Debit - деньги ушли
  @Column({ name: 'type', type: 'varchar', nullable: true, length: 2 ** 4 })
  readonly type: 'Credit' | 'Debit';

  @Column({ name: 'place', type: 'varchar', length: 2 ** 4 })
  readonly place: 'ton' | 'yookassa' | 'wechat' | 'telegram' | 'inner_service';

  @Column({ name: 'completed', type: 'boolean', default: false })
  readonly completed: boolean;

  @Column({ name: 'payment_url', type: 'text', nullable: true })
  readonly paymentUrl?: string;

  @Column({ name: 'paymentId', type: 'varchar', unique: true, nullable: true })
  readonly paymentId?: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  readonly user: UserEntity;
}
