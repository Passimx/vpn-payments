import { Injectable } from '@nestjs/common';
import { Address, Slice, TonClient, Transaction } from '@ton/ton';
import { Envs } from '../../common/env/envs';
import { DataSource, EntityManager, JsonContains } from 'typeorm';
import { TransactionEntity } from '../database/entities/transaction.entity';
import { OpCodeEnum } from './enums/op-code.enum';
import { TransactionsService } from '../transactions/transactions.service';
import { logger } from '../../common/logger/logger';
import { CurrencyEnum } from '../transactions/types/currency.enum';
import { AppWalletEnum } from './enums/app-wallet.enum';

@Injectable()
export class TonService {
  constructor(
    private readonly em: EntityManager,
    private readonly dataSource: DataSource,
    private readonly transactionsService: TransactionsService,
  ) {}

  public async scanTransactions(): Promise<void> {
    const client = new TonClient({
      endpoint: Envs.crypto.ton.endpointUrl,
      apiKey: Envs.crypto.ton.endpointApiKey,
    });

    const address = Address.parse(Envs.crypto.ton.walletAddress);
    const response = await client
      .getTransactions(address, {
        limit: 20,
      })
      .catch(() => {
        logger.error('Error while getting ton transactions.');
      });

    if (!response || !response.length) return;

    const blockchainTransactions = response
      .map(this.getTransactionInf)
      .filter((transactionEntity) => !!transactionEntity);

    blockchainTransactions.map((transaction) => transaction?.message);

    const uniqueMassages = [
      ...new Set(
        blockchainTransactions.map((transaction) => transaction?.message),
      ),
    ];

    const transactions = await this.em
      .createQueryBuilder(TransactionEntity, 'transaction')
      .where('transaction.id::text = ANY(:ids::text[])', {
        ids: uniqueMassages,
      })
      .andWhere({ meta: JsonContains({ place: 'ton' }) })
      .andWhere('transaction.completed IS FALSE')
      .getMany();

    if (!transactions.length) return;

    const updatedTransactions = transactions.map((transactionEntity) => {
      const blockchainTransaction = blockchainTransactions.find(
        (blockchainTransaction) =>
          blockchainTransaction?.message === transactionEntity.id,
      )!;
      return {
        ...transactionEntity,
        amount: blockchainTransaction.amount,
        currency: blockchainTransaction.currency,
        completed: true,
      };
    });

    await this.dataSource.transaction(async (manager) => {
      await manager.save(TransactionEntity, updatedTransactions);
      await this.addBalance(updatedTransactions, manager);
    });
  }

  public async getTonInvoice(
    userId: string,
    amount: number,
    currency: CurrencyEnum.TON | CurrencyEnum.USD,
    app: AppWalletEnum,
  ): Promise<string> {
    console.log([amount, currency, app]);
    const transaction = await this.em.save(TransactionEntity, {
      userId: userId,
      amount,
      currency,
      type: 'Credit',
      kind: 'Deposit',
      completed: false,
      meta: {
        place: 'ton',
      },
    });

    let paymentUrl = 'https://tonhub.com';

    if (app === AppWalletEnum.MY_TON_WALLET)
      paymentUrl = 'https://my.tt/transfer';
    if (app === AppWalletEnum.TON_KEEPER)
      paymentUrl = 'https://app.tonkeeper.com';

    paymentUrl += `/transfer/${Envs.crypto.ton.walletAddress}`;

    if (currency === CurrencyEnum.USD)
      paymentUrl += `?amount=${amount * 1e6}&jetton=EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs`;
    else paymentUrl += `?amount=${amount * 1e9}`;

    paymentUrl += `&text=${transaction.id}`;

    return paymentUrl;
  }

  private addBalance(
    transactions: Partial<TransactionEntity>[],
    manager: EntityManager,
  ) {
    return Promise.all(
      transactions.map(async (transaction) => {
        await this.transactionsService.addBalance(
          transaction.userId!,
          transaction.amount!,
          transaction.currency!,
          manager,
        );
      }),
    );
  }

  private getTransactionInf = (transaction: Transaction) => {
    const msg = transaction.inMessage;

    if (!msg || msg.info.type !== 'internal') return;

    const slice = msg.body.beginParse();
    if (slice.remainingBits < 32) return;
    const op = slice.loadUint(32) as OpCodeEnum;

    if (op === OpCodeEnum.OP_TRANSFER_NOTIFICATION) {
      const jettonWalletAddress = msg?.info.src?.toString();
      if (jettonWalletAddress != Envs.crypto.ton.jettonWalletAddress) return;

      slice.loadUintBig(64);
      const jettonAmount = slice.loadCoins();
      slice.loadAddress(); // jetton wallet sender
      const isRight = slice.loadBit();
      let message: string | undefined = undefined;

      const payloadSlice: Slice = isRight
        ? slice.loadRef().beginParse()
        : slice;

      const payloadOp = payloadSlice.loadUint(32);

      if (payloadOp === 0) message = payloadSlice.loadStringTail();

      return {
        currency: CurrencyEnum.USD,
        amount: Number(jettonAmount) / 1e6,
        message,
      };
    }

    if (op === OpCodeEnum.OP_SEND) {
      const message = slice
        .loadBuffer(slice.remainingBits / 8)
        .toString('utf8')
        .replace(/^\n+|\n+$/g, '')
        .trim();

      return {
        currency: CurrencyEnum.TON,
        amount: Number(msg.info.value.coins) / 1e9,
        message,
      };
    }
  };
}
