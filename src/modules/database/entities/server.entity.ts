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

  @Column({ type: 'varchar', length: 2 ** 4, default: 'active' })
  readonly status: 'active' | 'inactive';

  @Column({ name: 'code', type: 'varchar' })
  readonly code: string;

  @OneToMany(() => UserKeyEntity, (userKeyEntity) => userKeyEntity.server)
  readonly keys: UserKeyEntity[];
}
