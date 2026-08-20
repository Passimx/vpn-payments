import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';
import type { CurrencyEnum } from '../../transactions/types/currency.enum';
import { PaymentMeta } from './meta/payment-meta';

@Entity({ name: 'payments' })
export class PaymentsEntity {
  @PrimaryGeneratedColumn('uuid')
  readonly id: string;

  @Column({ name: 'user_id', type: 'varchar' })
  readonly userId: string;

  @Column({ name: 'amount', type: 'numeric', precision: 12 })
  readonly amount: number;

  @Column({ name: 'currency', type: 'varchar' })
  readonly currency: CurrencyEnum;

  @Column({ name: 'type', type: 'varchar', length: 2 ** 4 })
  readonly type: 'Credit' | 'Debit';

  @Column({ name: 'place', type: 'varchar', length: 2 ** 4 })
  readonly place: 'ton' | 'yookassa' | 'wechat' | 'telegram' | 'inner_service';

  @Column({ name: 'completed', type: 'boolean', default: true })
  readonly completed: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  readonly createdAt: Date;

  @Column({ type: 'jsonb', nullable: true })
  readonly meta!: PaymentMeta;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  readonly user: UserEntity;
}
