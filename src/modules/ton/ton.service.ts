import { Injectable } from '@nestjs/common';
import { Address, Slice, TonClient, Transaction } from '@ton/ton';
import { Envs } from '../../common/env/envs';
import { EntityManager } from 'typeorm';
import { TransactionEntity } from '../database/entities/transaction.entity';
import { UserEntity } from '../database/entities/user.entity';

const OP_TRANSFER_NOTIFICATION = 0x7362d09c;
const OP_SEND = 0x00000000;

@Injectable()
export class TonService {
  constructor(private readonly em: EntityManager) {}

  public async scanTransactions(): Promise<void> {
    const client = new TonClient({
      endpoint: Envs.ton.endpointUrl,
      apiKey: Envs.ton.endpointApiKey,
    });

    const [transactionEntity] = await this.em.find(TransactionEntity, {
      where: { place: 'ton' },
      order: { id: 'DESC' },
    });

    const address = Address.parse(Envs.ton.walletAddress);
    const transactions = await client
      .getTransactions(address, {
        limit: 500,
      })
      .catch(() => {
        console.log('Error while getting transactions.');
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
  }

  private getTransactionInf(transaction: Transaction) {
    const msg = transaction.inMessage;

    if (!msg || msg.info.type !== 'internal') return;

    const slice = msg.body.beginParse();
    if (slice.remainingBits < 32) return;
    const op = slice.loadUint(32);

    if (op === OP_TRANSFER_NOTIFICATION) {
      const jettonWalletAddress = msg?.info.src?.toString();
      if (jettonWalletAddress != Envs.ton.jettonWalletAddress) return;

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

    if (op === OP_SEND) {
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
