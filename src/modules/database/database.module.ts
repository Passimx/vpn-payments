import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Envs } from '../../common/env/envs';
import { resolve } from 'path';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: Envs.database.host,
      port: Envs.database.port,
      database: Envs.database.database,
      username: Envs.database.username,
      password: Envs.database.password,
      synchronize: true,
      entities: [resolve(__dirname + '/../**/*.entity{.ts,.js}')],
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
