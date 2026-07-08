import { Injectable } from '@nestjs/common';
import { PassimxApps } from '../../@passimx';
import { logger } from '../../common/logger/logger';

@Injectable()
export class PassimxService {
  onModuleInit(): void {
    const pa = new PassimxApps('token');

    pa.start();
    pa.catch((error) => logger.error(error));
  }
}
