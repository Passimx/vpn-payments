import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Envs } from '../../common/env/envs';
import { resolve } from 'path';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

export const dbOptions: PostgresConnectionOptions = {
  type: 'postgres',
  host: Envs.database.host,
  port: Envs.database.port,
  database: Envs.database.database,
  username: Envs.database.username,
  password: Envs.database.password,
  logging: Envs.database.logging,
  synchronize: true,
  entities: [resolve(__dirname + '/../**/*.entity{.ts,.js}')],
};

@Global()
@Module({
  imports: [TypeOrmModule.forRoot(dbOptions)],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
