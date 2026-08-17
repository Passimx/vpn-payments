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
  @Column({ name: 'discount_percent', type: 'int', default: 0 })
  readonly discountPercent: number;

  @Column({ name: 'is_free_key', type: 'boolean', default: false })
  readonly isFreeKey: boolean;

  @Column({ name: 'active', type: 'boolean', default: true })
  readonly active: boolean;

  @Column({
    name: 'allowed_tariff_ids',
    type: 'uuid',
    array: true,
    nullable: true,
  })
  readonly allowedTariffIds: string[] | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  readonly createdAt: Date;
}
