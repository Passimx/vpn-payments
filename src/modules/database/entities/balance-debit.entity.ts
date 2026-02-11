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
import { VpnKeyEntity } from './vpn-key.entity';

@Entity({ name: 'payments' })
export class PaymentsEntity {
  @PrimaryGeneratedColumn('uuid')
  readonly id: string;

  @Column({ name: 'user_id', type: 'varchar' })
  readonly userId: string;

  @Column({name: 'amount', type: 'numeric', precision: 12})
  readonly amount: number;

  @Column({ name: 'tariff_id', type: 'varchar' })
  readonly tariffId: string;

  @Column({ name: 'vpn_key_id', type: 'varchar' })
  readonly vpnKeyId: string;

  @CreateDateColumn({ name: 'created_at' })
  readonly createdAt: Date;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  readonly user: UserEntity;

  @ManyToOne(() => TariffEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tariff_id' })
  readonly tariff: TariffEntity;

  @ManyToOne(() => VpnKeyEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'vpn_key_id' })
  readonly vpnKey: VpnKeyEntity;
}
