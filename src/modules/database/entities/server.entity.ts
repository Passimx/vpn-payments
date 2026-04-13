import { Column, Entity, PrimaryGeneratedColumn, OneToMany } from 'typeorm';
import { UserKeyEntity } from './user-key.entity';

@Entity('servers')
export class ServerEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  readonly id: string;

  @Column({ type: 'varchar' })
  readonly host: string;

  @Column({ name: 'can_default_create_key', type: 'boolean', default: false })
  readonly canDefaultCreateKey: boolean;

  @Column({ name: 'can_create_key', type: 'boolean', default: false })
  readonly canCreateKey: boolean;

  @Column({ name: 'code', type: 'varchar' })
  readonly code: string;

  @Column({ name: 'port', type: 'int', nullable: true })
  readonly port: number | null;

  @Column({ name: 'for_cascade_inbound_tag', type: 'varchar', nullable: true })
  readonly forCascadeInboundTag: string | null;

  @OneToMany(() => UserKeyEntity, (userKeyEntity) => userKeyEntity.server)
  readonly keys: UserKeyEntity[];

  @OneToMany(() => UserKeyEntity, (userKeyEntity) => userKeyEntity.cascadeToServer)
  readonly cascadeTargetForKeys?: UserKeyEntity[];
}
