import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'tariffs' })
export class TariffEntity {
  @PrimaryGeneratedColumn('uuid')
  readonly id: string;

  @Column({ name: 'name', type: 'varchar', length: 128 })
  readonly name: string;

  @Column({ name: 'traffic_gb', type: 'int', default: 0 })
  readonly trafficGb: number;

  @Column({ name: 'expiration_days', type: 'int' })
  readonly expirationDays: number;

  @Column({ name: 'price', type: 'numeric' })
  readonly price: number;

  @Column({ name: 'is_unlimited', type: 'boolean', default: false })
  readonly isUnlimited: boolean;

  @Column({ name: 'active', type: 'boolean', default: true })
  readonly active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  readonly createdAt: Date;
}
