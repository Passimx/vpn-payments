import { Injectable } from '@nestjs/common';
import { Address, Message, TonClient, Transaction } from '@ton/ton';
import { Envs } from '../../common/env/envs';
import { EntityManager } from 'typeorm';
import { TransactionEntity } from '../database/entities/transaction.entity';
import { UserEntity } from '../database/entities/user.entity';

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
      order: { createdAt: 'DESC' },
    });

    const address = Address.parse(Envs.ton.walletAddress);
    const transactions = await client.getTransactions(address, {
      limit: 500,
    });

    const transactionEntities = (
      await Promise.all(
        transactions.map(async (transaction) => {
          try {
            let userId: string | undefined = undefined;
            const message = extractComment(transaction);
            const payload = parsePureTon(transaction, address);

            if (!payload) return undefined;

            if (message?.length) {
              const userEntity = await this.em.findOne(UserEntity, {
                where: { id: message },
              });
              if (userEntity) userId = userEntity.id;
            }

            return {
              id: transaction.lt,
              amount: payload.amount,
              currency: payload?.currency,
              message,
              type: payload?.type,
              place: 'ton',
              userId,
              createdAt: transaction.now * 1000,
            } as unknown as TransactionEntity;
          } catch (error) {
            console.log(error);
            return undefined as unknown as TransactionEntity;
          }
        }),
      )
    ).filter(
      (transaction) =>
        transaction &&
        (!transactionEntity ||
          transaction.createdAt > transactionEntity?.createdAt),
    ) as unknown as TransactionEntity;

    await this.em.insert(TransactionEntity, transactionEntities);
  }
}

function parsePureTon(tx: Transaction, myAddress: Address) {
  let incoming = 0n;
  let outgoing = 0n;

  if (
    tx.inMessage?.info.type === 'internal' &&
    tx.inMessage.info.dest.equals(myAddress)
  ) {
    incoming += tx.inMessage.info.value.coins;
  }

  for (const [, msg] of tx.outMessages) {
    if (msg.info.type === 'internal' && msg.info.src.equals(myAddress)) {
      outgoing += msg.info.value.coins;
    }
  }

  if (incoming > 0n) {
    return {
      currency: 'TON',
      type: 'Credit',
      amount: Number(incoming) / 1e9,
    };
  }

  if (outgoing > 0n) {
    return {
      currency: 'TON',
      type: 'Debit',
      amount: Number(outgoing) / 1e9,
    };
  }

  return null;
}

function readTonComment(msg?: Message | null): string | null {
  if (!msg?.body || msg.info.type !== 'internal') return null;

  const slice = msg.body.beginParse();

  if (slice.remainingBits < 32) return null;

  const op = slice.loadUint(32);
  if (op !== 0) return null;

  if (slice.remainingBits % 8 !== 0) return null;

  return slice
    .loadBuffer(slice.remainingBits / 8)
    .toString('utf8')
    .replace(/^\n+|\n+$/g, '')
    .trim();
}

function extractComment(tx: Transaction): string | null {
  // 1️⃣ входящее сообщение
  let comment = readTonComment(tx.inMessage);
  if (comment) return comment;

  // 2️⃣ исходящие сообщения
  for (const [, msg] of tx.outMessages) {
    comment = readTonComment(msg);
    if (comment) return comment;
  }

  return null;
}
