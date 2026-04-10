import { Controller, Post, Query } from '@nestjs/common';
import { XrayService } from './xray-service';

@Controller('xray')
export class XrayController {
  constructor(private readonly xrayService: XrayService) {}

  @Post('backup-keys')
  async syncXrayKeys(@Query('serverId') serverId?: string) {
    const synced = await this.xrayService.syncActiveKeys(serverId);
    return { synced };
  }
}
