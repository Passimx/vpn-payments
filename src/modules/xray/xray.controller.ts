import { Body, Controller, Param, Post, Query } from '@nestjs/common';
import { CreateServerDto } from './dto/create-server.dto';
import { XrayService } from './xray-service';

@Controller('xray')
export class XrayController {
  constructor(private readonly xrayService: XrayService) {}

  @Post('servers')
  createServer(@Body() body: CreateServerDto) {
    return this.xrayService.createServer(body);
  }

  @Post('servers/:serverId/patch-keys')
  patchServerKeys(@Param('serverId') serverId: string) {
    return this.xrayService.patchActiveKeysToServer(serverId);
  }

  @Post('backup-keys')
  async syncXrayKeys(@Query('serverId') serverId?: string) {
    const synced = await this.xrayService.syncActiveKeys(serverId);
    return { synced };
  }
}
