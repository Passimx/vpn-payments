import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Index,
} from 'typeorm';
import { UserEntity } from './user.entity';
import { PromoCodeEntity } from './promo-code.entity';

@Entity({ name: 'promocode_usages' })
@Index(['userId', 'promoCodeId'], { unique: true })
export class PromoUsageEntity {
  @PrimaryGeneratedColumn('uuid')
  readonly id: string;

  @Column({ name: 'user_id', type: 'varchar' })
  readonly userId: string;

  @Column({ name: 'promocode_id', type: 'varchar' })
  readonly promoCodeId: string;

  @CreateDateColumn({ name: 'used_at' })
  readonly usedAt: Date;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  readonly user: UserEntity;

  @ManyToOne(() => PromoCodeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'promo_code_id' })
  readonly promoCode: PromoCodeEntity;
}
