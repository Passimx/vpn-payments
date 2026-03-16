import { Column, Entity, PrimaryGeneratedColumn, OneToMany } from 'typeorm';
import { UserKeyEntity } from './user-key.entity';

@Entity('servers')
export class ServerEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  readonly id: string;

  @Column({ type: 'varchar' })
  readonly host: string;

  @Column({ type: 'varchar' })
  readonly username: string;

  @Column({ type: 'varchar' })
  readonly password: string;

  @Column({ type: 'int' })
  readonly xRayPort: string;

  @Column({ type: 'varchar' })
  readonly xRayServername: string;

  @Column({ name: 'can_default_create_key', type: 'boolean', default: false })
  readonly canDefaultCreateKey: boolean;

  @Column({ name: 'can_create_key', type: 'boolean', default: false })
  readonly canCreateKey: boolean;

  @Column({ name: 'code', type: 'varchar' })
  readonly code: string;

  @OneToMany(() => UserKeyEntity, (userKeyEntity) => userKeyEntity.server)
  readonly keys: UserKeyEntity[];
}
