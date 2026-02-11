import { Body, Controller, Post } from '@nestjs/common';
import { TariffsService } from './tariffs.service';
import { CreateTariffDto } from './dto/create-tariff.dto';
import { TariffEntity } from '../database/entities/tariff.entity';

@Controller('tariffs')
export class TariffsController {
  constructor(private readonly tariffsService: TariffsService) {}

  @Post()
  async create(@Body() dto: CreateTariffDto): Promise<TariffEntity> {
    return this.tariffsService.create(dto);
  }
}
