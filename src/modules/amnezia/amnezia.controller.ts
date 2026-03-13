import { Controller, Post, Query } from '@nestjs/common';
import { AmneziaService } from './amnezia-service';

@Controller('amnezia')
export class AmneziaController {
  constructor(private readonly amneziaService: AmneziaService) {}

  @Post('backup-keys')
  async syncXrayKeys(@Query('serverId') serverId?: string) {
    const synced = await this.amneziaService.syncActiveKeys(serverId);
    return { synced };
  }
}
