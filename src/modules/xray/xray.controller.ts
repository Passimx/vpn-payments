import { Body, Controller, Post } from '@nestjs/common';
import { CreateServerDto } from './dto/create-server.dto';
import { XrayService } from './xray-service';

@Controller('xray')
export class XrayController {
  constructor(private readonly xrayService: XrayService) {}

  @Post('servers')
  createServer(@Body() body: CreateServerDto) {
    return this.xrayService.createServer(body);
  }
}
