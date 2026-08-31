import { UserEntity } from '../../../database/entities/user.entity';
import { CurrencyEnum } from '../../../transactions/types/currency.enum';
import { TransactionDto } from './transaction.dto';
import { UserKeyDto } from './user-key.dto';

export class UserResponseDto {
  readonly id: string;

  readonly balance: Record<CurrencyEnum, number> & { seqno: number };

  readonly keys: UserKeyDto[];

  readonly transactions: TransactionDto[];

  constructor(payload: UserResponseDto) {
    Object.assign(this, payload);
  }

  public static getFromUserEntity(user: UserEntity) {
    const keys = user.keys.map((key) => UserKeyDto.getFromUserKey(key));
    const transactions = user.transactions.map((key) =>
      TransactionDto.getFromTransaction(key),
    );

    return new UserResponseDto({
      id: user.id,
      balance: {
        rub: user.balanceAccount.rub,
        cny: user.balanceAccount.cny,
        usd: user.balanceAccount.usd,
        ton: user.balanceAccount.ton,
        bitcoin: user.balanceAccount.bitcoin,
        ethereum: user.balanceAccount.ethereum,
        seqno: user.balanceAccount.seqno,
      },
      keys,
      transactions,
    });
  }
}
