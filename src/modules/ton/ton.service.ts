import { Injectable } from '@nestjs/common';
import { Address, Slice, TonClient, Transaction } from '@ton/ton';
import { Envs } from '../../common/env/envs';
import { EntityManager } from 'typeorm';
import { TransactionEntity } from '../database/entities/transaction.entity';
import { UserEntity } from '../database/entities/user.entity';
import { OpCodeEnum } from './enums/op-code.enum';
import { TransactionsService } from '../transactions/transactions.service';
import { TelegramService } from '../telegram/telegram-service';

@Injectable()
export class TonService {
  constructor(
    private readonly em: EntityManager,
    private readonly transactionsService: TransactionsService,
    private readonly telegramService: TelegramService,
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
        console.log('Error while getting ton transactions.');
      });

    if (!transactions || !transactions.length) return;

    const slice = transactions[0]?.inMessage?.body.beginParse();
    if (!slice || slice.remainingBits < 32) return;

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
            amount: payload?.amount,
            currency: payload?.currency,
            message: payload?.message,
            type: payload?.type,
            place: 'ton',
            userId,
            createdAt: transaction.now * 1e3,
          } as unknown as TransactionEntity;
        } catch (error) {
          console.log(error);
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

  private async addBalance(transactions: TransactionEntity[]) {
    const priceCollection = await this.transactionsService.getCurrencyPrice();
    if (!priceCollection) return;

    await Promise.all(
      transactions.map(async (transaction) => {
        let addBalance =
          transaction.amount * priceCollection['the-open-network'].rub;
        if (transaction.currency !== 'rub')
          addBalance += addBalance * Envs.crypto.allowance;

        await this.em
          .createQueryBuilder()
          .update(UserEntity)
          .set({
            balance: () => `balance + ${addBalance}`,
          })
          .where('id = :id', { id: transaction.userId })
          .execute();

        await this.em.update(
          TransactionEntity,
          { id: transaction.id },
          { completed: true },
        );

        await this.telegramService.sendMessageAddBalance(
          transaction.userId,
          addBalance,
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
        currency: 'USD',
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
        currency: 'TON',
        type: 'Credit',
        amount: Number(msg.info.value.coins) / 1e9,
        message,
      };
    }
  }
}
