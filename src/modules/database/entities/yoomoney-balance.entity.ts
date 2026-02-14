import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';

@Entity({ name: 'yoomoney_balance_payments' })
export class YooMoneyBalancePaymentEntity {
  @PrimaryGeneratedColumn('uuid')
  readonly id: string;

  @Column({ name: 'user_id', type: 'varchar' })
  readonly userId: string;

  @Column({ name: 'label', type: 'varchar', unique: true })
  readonly label: string;

  @Column({ name: 'amount', type: 'numeric' })
  readonly amount: number;

  @Column({
    name: 'status',
    type: 'varchar',
    default: 'pending',
  })
  readonly status: 'pending' | 'paid';

  @Column({ name: 'payment_url', type: 'text' })
  readonly paymentUrl: string;

  @CreateDateColumn({ name: 'created_at' })
  readonly createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  readonly updatedAt: Date;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  readonly user: UserEntity;
}
