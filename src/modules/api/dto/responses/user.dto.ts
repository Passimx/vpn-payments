import { UserEntity } from '../../../database/entities/user.entity';
import { UserKeyEntity } from '../../../database/entities/user-key.entity';
import { BalanceAccount } from '../../../database/entities/balance-account.entity';

export class UserKeyDto {
  readonly id: string;

  readonly key: string;

  readonly expiresAt: Date;

  readonly createdAt: Date;

  readonly status: string;

  readonly serverCode: string;

  readonly serverId: string;

  readonly autoRenewEnabled: boolean;

  readonly countTrafficLimit: number | null;

  readonly countTrafficUsed: number | null;

  constructor(payload: UserKeyDto) {
    Object.assign(this, payload);
  }

  public static getFromUserKey(key: UserKeyEntity) {
    return new UserKeyDto({
      id: key.id,
      key: key.key,
      expiresAt: key.expiresAt,
      createdAt: key.createdAt,
      status: key.status,
      serverCode: key.server.code,
      serverId: key.server.id,
      autoRenewEnabled: key.autoRenewEnabled,
      countTrafficLimit: key.countTrafficLimit,
      countTrafficUsed: key.countTrafficUsed,
    });
  }
}

export class UserResponseDto {
  readonly id: string;

  readonly balanceAccount: BalanceAccount;

  readonly keys: UserKeyDto[];

  constructor(payload: UserResponseDto) {
    Object.assign(this, payload);
  }

  public static getFromUserEntity(user: UserEntity) {
    const keys = user.keys.map((key) => UserKeyDto.getFromUserKey(key));

    return new UserResponseDto({
      id: user.id,
      balanceAccount: user.balanceAccount,
      keys,
    });
  }
}
