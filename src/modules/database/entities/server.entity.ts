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

  @OneToMany(() => UserKeyEntity, (userKeyEntity) => userKeyEntity.server)
  readonly keys: UserKeyEntity[];
}
