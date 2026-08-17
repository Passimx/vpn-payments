import { TariffEntity } from '../../../database/entities/tariff.entity';

class TariffDto {
  readonly id: string;

  readonly expirationDays: number;

  readonly price: number;

  readonly trafficLimit: number;

  readonly kind: string;

  constructor(payload: Partial<TariffDto>) {
    Object.assign(this, payload);
  }
}

export class GetTariffsDto {
  readonly base: TariffDto[];

  readonly cdn: TariffDto[];

  constructor(base: TariffDto[], cdn: TariffDto[]) {
    this.base = base;
    this.cdn = cdn;
  }

  public static creteInstanceFromEntities(tariffs: TariffEntity[]) {
    const tariffDtos: TariffDto[] = tariffs.map(
      ({ id, expirationDays, price, trafficLimit, kind }) =>
        new TariffDto({ id, expirationDays, price, trafficLimit, kind }),
    );

    const cdn = tariffDtos.filter((tariff) => tariff.kind === 'cdn');
    const base = tariffDtos.filter((tariff) => tariff.kind === 'base');

    return new GetTariffsDto(base, cdn);
  }
}
