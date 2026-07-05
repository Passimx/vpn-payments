import { UserEntity } from '../../../database/entities/user.entity';
import { UserKeyEntity } from '../../../database/entities/user-key.entity';
import { BalanceAccount } from '../../../database/entities/balance-account.entity';

export class UserKeyDto {
  readonly id: string;

  readonly expiresAt: Date;

  readonly createdAt: Date;

  readonly status: string;

  readonly autoRenewEnabled: boolean;

  readonly countTrafficLimit: number | null;

  readonly countTrafficUsed: number | null;

  constructor(payload: UserKeyDto) {
    Object.assign(this, payload);
  }

  public static getFromUserKey(key: UserKeyEntity) {
    return new UserKeyDto({
      id: key.id,
      expiresAt: key.expiresAt,
      createdAt: key.createdAt,
      status: key.status,
      autoRenewEnabled: key.autoRenewEnabled,
      countTrafficLimit: key.countTrafficLimit,
      countTrafficUsed: key.countTrafficUsed,
    });
  }
}

export class UserResponseDto {
  readonly id: string;

  readonly balance: BalanceAccount;

  readonly keys: UserKeyDto[];

  constructor(payload: UserResponseDto) {
    Object.assign(this, payload);
  }

  public static getFromUserEntity(user: UserEntity) {
    const keys = user.keys.map((key) => UserKeyDto.getFromUserKey(key));

    return new UserResponseDto({
      id: user.id,
      balance: user.balanceAccount,
      keys,
    });
  }
}
