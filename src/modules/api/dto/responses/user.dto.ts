import { UserEntity } from '../../../database/entities/user.entity';
import { UserKeyEntity } from '../../../database/entities/user-key.entity';
import { TariffKind } from '../../../database/entities/tariff.entity';
import { CurrencyEnum } from '../../../transactions/types/currency.enum';

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

export class UserResponseDto {
  readonly id: string;

  readonly balance: Record<CurrencyEnum, number>;

  readonly keys: UserKeyDto[];

  constructor(payload: UserResponseDto) {
    Object.assign(this, payload);
  }

  public static getFromUserEntity(user: UserEntity) {
    const keys = user.keys.map((key) => UserKeyDto.getFromUserKey(key));

    return new UserResponseDto({
      id: user.id,
      balance: {
        rub: user.balanceAccount.rub,
        cny: user.balanceAccount.cny,
        usd: user.balanceAccount.usd,
        ton: user.balanceAccount.ton,
      },
      keys,
    });
  }
}
