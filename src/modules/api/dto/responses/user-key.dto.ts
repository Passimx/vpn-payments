import { TariffKind } from '../../../database/entities/tariff.entity';
import { UserKeyEntity } from '../../../database/entities/user-key.entity';

export class UserKeyDto {
  readonly id: string;

  readonly expiresAt: Date;

  readonly createdAt: Date;

  readonly status: string;

  readonly autoExtendTariffId: string | null;

  readonly countTrafficLimit: number | null;

  readonly countTrafficUsed: number | null;

  readonly kind: TariffKind;

  constructor(payload: UserKeyDto) {
    Object.assign(this, payload);
  }

  public static getFromUserKey(key: UserKeyEntity) {
    return new UserKeyDto({
      id: key.id,
      expiresAt: key.expiresAt,
      createdAt: key.createdAt,
      status: key.status,
      autoExtendTariffId: key.autoExtendTariffId,
      countTrafficLimit: key.countTrafficLimit,
      countTrafficUsed: key.countTrafficUsed,
      kind: key.tariff.kind,
    });
  }
}
