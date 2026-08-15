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

  @Column({
    name: 'expiration_days',
    type: 'int',
    transformer: {
      to: (value: string) => Number(value),
      from: (value: string) => Number(value),
    },
  })
  readonly expirationDays: number;

  @Column({
    name: 'price',
    type: 'numeric',
    transformer: {
      to: (value: string) => Number(value),
      from: (value: string) => Number(value),
    },
  })
  readonly price: number;

  @Column({
    name: 'traffic_limit',
    type: 'bigint',
    transformer: {
      to: (value: string) => Number(value),
      from: (value: string) => Number(value),
    },
  })
  readonly trafficLimit: number;

  @Column({ name: 'kind', type: 'varchar', default: 'base' })
  readonly kind: TariffKind;

  @Column({ name: 'active', type: 'boolean', default: true })
  readonly active: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  readonly createdAt: Date;
}
