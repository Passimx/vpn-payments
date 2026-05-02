import { UserEntity } from '../../../database/entities/user.entity';
import { UserKeyEntity } from '../../../database/entities/user-key.entity';

export class UserKeyDto {
  readonly id: string;

  readonly key: string;

  readonly expiresAt: Date;

  readonly createdAt: Date;

  readonly status: string;

  readonly serverCode: string;

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
    });
  }
}

export class UserResponseDto {
  readonly id: string;

  readonly balance: number;

  readonly keys: UserKeyDto[];

  constructor(payload: UserResponseDto) {
    Object.assign(this, payload);
  }

  public static getFromUserEntity(user: UserEntity) {
    const keys = user.keys.map((key) => UserKeyDto.getFromUserKey(key));

    return new UserResponseDto({
      id: user.id,
      balance: user.balance,
      keys,
    });
  }
}
