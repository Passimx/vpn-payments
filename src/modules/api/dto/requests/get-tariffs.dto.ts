class TariffDto {
  readonly id: string;

  readonly expirationDays: number;

  readonly price: number;

  readonly trafficLimit: number;
}

export class GetTariffsDto {
  readonly base: TariffDto[];

  readonly cdn: TariffDto[];

  constructor(base: TariffDto[], cdn: TariffDto[]) {
    this.base = base;
    this.cdn = cdn;
  }

  public static creteInstance(base: TariffDto[], cdn: TariffDto[]) {
    return new GetTariffsDto(base, cdn);
  }
}
