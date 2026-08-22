import { TransactionEntity } from '../../../database/entities/transaction.entity';
import type { CurrencyEnum } from '../../../transactions/types/currency.enum';
import { DepositMeta } from '../../../database/entities/meta/deposit-meta';
import { PaymentMeta } from '../../../database/entities/meta/payment-meta';
import { TransferMeta } from '../../../database/entities/meta/transfer-meta';

export class TransactionDto {
  readonly id: string;

  readonly amount: number;

  readonly currency: CurrencyEnum;

  readonly type: 'Credit' | 'Debit';

  readonly kind: 'Transfer' | 'Payment' | 'Deposit' | 'Exchange';

  readonly completed: boolean;

  readonly meta!: DepositMeta | PaymentMeta | TransferMeta;

  readonly createdAt: Date;

  constructor(payload: TransactionDto) {
    Object.assign(this, payload);
  }

  public static getFromTransaction(transaction: TransactionEntity) {
    return new TransactionDto({
      id: transaction.id,
      amount: transaction.amount,
      currency: transaction.currency,
      type: transaction.type,
      kind: transaction.kind,
      completed: transaction.completed,
      meta: transaction.meta,
      createdAt: transaction.createdAt,
    });
  }
}
