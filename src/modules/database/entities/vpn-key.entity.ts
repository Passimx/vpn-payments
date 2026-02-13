import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';
import { TariffEntity } from './tariff.entity';

@Entity({ name: 'vpn_keys' })
export class VpnKeyEntity {
  @PrimaryGeneratedColumn('uuid')
  readonly id: string;

  @Column({ name: 'user_id', type: 'varchar' })
  readonly userId: string;

  @Column({ name: 'vpn_username', type: 'varchar', length: 64, unique: true })
  readonly vpnUsername: string;

  @Column({ name: 'vpn_uri', type: 'text', nullable: true })
  readonly vpnUri: string | null;

  @Column({ name: 'traffic_limit_gb', type: 'int', default: 0 })
  readonly trafficLimitGb: number;

  @Column({ name: 'expiration_days', type: 'int' })
  readonly expirationDays: number;

  @Column({ name: 'expires_at', type: 'timestamp' })
  readonly expiresAt: Date;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'active' })
  readonly status: 'active' | 'expired' | 'revoked';

  @Column({ name: 'tariff_id', type: 'varchar', nullable: true })
  readonly tariffId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  readonly createdAt: Date;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  readonly user: UserEntity;

  @ManyToOne(() => TariffEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'tariff_id' })
  readonly tariff: TariffEntity | null;
}
