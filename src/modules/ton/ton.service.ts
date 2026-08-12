import { Injectable } from '@nestjs/common';
import { Address, Slice, TonClient, Transaction } from '@ton/ton';
import { Envs } from '../../common/env/envs';
import { EntityManager } from 'typeorm';
import { TransactionEntity } from '../database/entities/transaction.entity';
import { UserEntity } from '../database/entities/user.entity';
import { OpCodeEnum } from './enums/op-code.enum';
import { TransactionsService } from '../transactions/transactions.service';
import { logger } from '../../common/logger/logger';
import { CurrencyEnum } from '../transactions/types/currency.enum';
import { AppWalletEnum } from './enums/app-wallet.enum';

@Injectable()
export class TonService {
  constructor(
    private readonly em: EntityManager,
    private readonly transactionsService: TransactionsService,
  ) {}

  public async scanTransactions(): Promise<void> {
    const client = new TonClient({
      endpoint: Envs.crypto.ton.endpointUrl,
      apiKey: Envs.crypto.ton.endpointApiKey,
    });

    const transactionEntity = await this.em.findOne(TransactionEntity, {
      where: { place: 'ton' },
      order: { id: 'DESC' },
    });

    const address = Address.parse(Envs.crypto.ton.walletAddress);
    const transactions = await client
      .getTransactions(address, {
        limit: 500,
      })
      .catch(() => {
        logger.error('Error while getting ton transactions.');
      });

    if (!transactions || !transactions.length) return;

    const transactionEntities = await Promise.all(
      transactions.map(async (transaction) => {
        try {
          let userId: string | undefined = undefined;
          const payload = this.getTransactionInf(transaction);
          if (!payload) return undefined;

          if (payload?.message?.length) {
            const userEntity = await this.em.findOne(UserEntity, {
              where: { id: payload.message },
            });
            if (userEntity) userId = userEntity.id;
          }

          if (!userId) return undefined;

          return {
            id: transaction.lt,
            amount: payload?.amount * (1 + Envs.crypto.allowance),
            currency: payload?.currency,
            message: payload?.message,
            type: payload?.type,
            place: 'ton',
            userId,
            createdAt: transaction.now * 1e3,
          } as unknown as TransactionEntity;
        } catch (error) {
          logger.error(error);
          return undefined as unknown as TransactionEntity;
        }
      }),
    );

    const transactionsNotEmpty = transactionEntities
      .filter((transactionEntity) => !!transactionEntity)
      .filter(
        (transaction) =>
          !transactionEntity ||
          transaction.createdAt > transactionEntity?.createdAt,
      );

    await this.em.insert(TransactionEntity, transactionsNotEmpty);

    if (transactions.length) await this.addBalance(transactionsNotEmpty);
  }

  public getTonInvoice(
    userId: string,
    amount: number,
    currency: CurrencyEnum.TON | CurrencyEnum.USD,
    app: AppWalletEnum,
  ): string {
    let paymentUrl = 'https://tonhub.com';

    if (app === AppWalletEnum.MY_TON_WALLET)
      paymentUrl = 'https://my.tt/transfer';
    if (app === AppWalletEnum.TON_KEEPER)
      paymentUrl = 'https://app.tonkeeper.com';

    paymentUrl += '/transfer';

    if (currency === CurrencyEnum.USD)
      paymentUrl += `/${Envs.crypto.ton.jettonWalletAddress}?amount=${amount * 1e6}&jetton=EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs`;
    else
      paymentUrl += `/${Envs.crypto.ton.walletAddress}?amount=${amount * 1e9}`;

    paymentUrl += `&text=${userId}`;

    return paymentUrl;
  }

  private async addBalance(transactions: TransactionEntity[]) {
    await Promise.all(
      transactions.map(async (transaction) => {
        await this.transactionsService.addBalance(
          transaction.userId,
          transaction.amount,
          transaction.currency,
        );

        await this.em.update(
          TransactionEntity,
          { id: transaction.id, place: 'ton' },
          { completed: true },
        );
      }),
    );
  }

  private getTransactionInf(transaction: Transaction) {
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
        type: 'Credit',
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
        type: 'Credit',
        amount: Number(msg.info.value.coins) / 1e9,
        message,
      };
    }
  }
}
