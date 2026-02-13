import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'promocodes' })
export class PromoCodeEntity {
  @PrimaryGeneratedColumn('uuid')
  readonly id: string;

  @Column({ name: 'code', type: 'varchar', length: 64, unique: true })
  readonly code: string;

  // Скидка в процентах (0–100). Если 100 — по сути бесплатный ключ.
  @Column({ name: 'discount_percent', type: 'int', default: 0 })
  readonly discountPercent: number;

  // Если true — ключ полностью бесплатный, баланс не списывается.
  @Column({ name: 'is_free_key', type: 'boolean', default: false })
  readonly isFreeKey: boolean;

  @Column({ name: 'active', type: 'boolean', default: true })
  readonly active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  readonly createdAt: Date;
}
