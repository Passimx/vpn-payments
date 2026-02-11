import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TariffEntity } from '../database/entities/tariff.entity';
import { CreateTariffDto } from './dto/create-tariff.dto';

@Injectable()
export class TariffsService {
  constructor(private readonly em: EntityManager) {}

  async create(dto: CreateTariffDto): Promise<TariffEntity> {
    const tariff = this.em.create(TariffEntity, {
      name: dto.name,
      trafficGb: dto.trafficGb,
      expirationDays: dto.expirationDays,
      price: dto.price,
      isUnlimited: dto.isUnlimited ?? false,
      active: dto.active ?? true,
    });
    return this.em.save(TariffEntity, tariff);
  }
}
