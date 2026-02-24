import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
} from 'typeorm';
import { UserEntity } from './user.entity';
import { ServerEntity } from './server.entity';
import { TariffEntity } from './tariff.entity';

@Entity('user_keys')
export class UserKeyEntity {
  @Column({ name: 'id', type: 'varchar', primary: true })
  readonly id: string;

  @Column({ name: 'key', type: 'varchar' })
  readonly key: string;

  @Column({ name: 'protocol', type: 'varchar' })
  readonly protocol: 'xray';

  @Column({ name: 'user_id', type: 'uuid' })
  readonly userId: string;

  @Column({ name: 'server_id', type: 'uuid' })
  readonly serverId: string;

  @Column({ name: 'tariff_id', type: 'uuid' })
  readonly tariffId: string;

  @Column({ name: 'expires_at', type: 'timestamp' })
  readonly expiresAt: Date;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 2 ** 4,
    default: 'active',
  })
  readonly status: 'active' | 'expired';

  @CreateDateColumn({ name: 'created_at' })
  readonly createdAt: Date;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  readonly user: UserEntity;

  @ManyToOne(() => ServerEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'server_id' })
  readonly server: ServerEntity;

  @ManyToOne(() => TariffEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tariff_id' })
  readonly tariff: TariffEntity;
}
