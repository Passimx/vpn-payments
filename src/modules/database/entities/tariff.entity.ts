import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type TariffKind = 'base' | 'cascade' | 'cdn';

@Entity({ name: 'tariffs' })
export class TariffEntity {
  @PrimaryGeneratedColumn('uuid')
  readonly id: string;

  @Column({ name: 'expiration_days', type: 'int' })
  readonly expirationDays: number;

  @Column({ name: 'price', type: 'numeric' })
  readonly price: number;

  @Column({ name: 'traffic_limit', type: 'bigint' })
  readonly trafficLimit: number;

  @Column({ name: 'kind', type: 'varchar', default: 'base' })
  readonly kind: TariffKind;

  @Column({ name: 'active', type: 'boolean', default: true })
  readonly active: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  readonly createdAt: Date;
}
