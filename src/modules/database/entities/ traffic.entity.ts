import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  UpdateDateColumn,
} from 'typeorm';
import { UserKeyEntity } from './user-key.entity';
import { ServerEntity } from './server.entity';

@Entity({ name: 'traffics' })
export class TrafficEntity {
  @Column({ name: 'key_id', primary: true })
  readonly keyId: string;

  @Column({ name: 'server_id', primary: true })
  readonly serverId: string;

  @Column({ name: 'up_link', type: 'bigint' })
  readonly upLink: number;

  @Column({ name: 'down_link', type: 'bigint' })
  readonly downLink: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  readonly updatedAt: Date;

  @ManyToOne(() => UserKeyEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'key_id' })
  readonly key: UserKeyEntity;

  @ManyToOne(() => ServerEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'server_id' })
  readonly server: ServerEntity;
}
