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
            const payload =
              parseJetton(transaction, address) ??
              parsePureTon(transaction, address);

            if (message?.length) {
              const userEntity = await this.em.findOne(UserEntity, {
                where: { id: message },
              });
              if (userEntity) userId = userEntity.id;
            }

            return {
              id: transaction.lt,
              amount: payload!.amount,
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
    );

    await this.em.insert(TransactionEntity, transactionEntities);
  }
}

const JETTON_TRANSFER = 0xf8a7ea5;

function findJettonTransfer(tx: Transaction) {
  const messages = [
    tx.inMessage,
    ...Array.from(tx.outMessages.values()),
  ].filter(Boolean);

  for (const msg of messages) {
    if (msg?.info.type !== 'internal' || !msg.body) continue;

    const slice = msg.body.beginParse();
    if (slice.remainingBits < 32) continue;

    const opcode = slice.loadUint(32);
    if (opcode === JETTON_TRANSFER) {
      return { msg, slice };
    }
  }

  return null;
}

function parseJetton(tx: Transaction, myAddress: Address) {
  const found = findJettonTransfer(tx);
  if (!found) return null;

  const { slice } = found;

  slice.loadUintBig(64); // query_id

  const amount = slice.loadCoins(); // bigint
  slice.loadAddress();
  const to = slice.loadAddress();

  const type = to.equals(myAddress) ? 'Credit' : 'Debit';

  return {
    currency: 'USDT',
    type,
    amount: Number(amount) / 1e6, // USDT decimals
  };
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
  let comment = readJettonComment(tx.inMessage);
  if (comment) return comment;

  comment = readTonComment(tx.inMessage);
  if (comment) return comment;

  // 2️⃣ исходящие сообщения
  for (const [, msg] of tx.outMessages) {
    comment = readJettonComment(msg);
    if (comment) return comment;

    comment = readTonComment(msg);
    if (comment) return comment;
  }

  return null;
}

function readJettonComment(msg?: Message | null): string | null {
  if (!msg?.body || msg.info.type !== 'internal') return null;

  const slice = msg.body.beginParse();
  if (slice.remainingBits < 32) return null;

  if (slice.loadUint(32) !== JETTON_TRANSFER) return null;

  slice.loadUintBig(64); // query_id
  slice.loadCoins(); // jetton amount
  slice.loadAddress(); // destination
  slice.loadAddress(); // response_destination

  // custom_payload
  if (slice.loadBit()) {
    slice.loadRef(); // обычно пусто
  }

  slice.loadCoins(); // forward_ton_amount

  // forward_payload
  const isRef = slice.loadBit();
  const payload = isRef ? slice.loadRef().beginParse() : slice;

  if (payload.remainingBits < 32) return null;

  const op = payload.loadUint(32);
  if (op !== 0) return null;

  return payload
    .loadBuffer(payload.remainingBits / 8)
    .toString('utf8')
    .replace(/^\n+|\n+$/g, '')
    .trim();
}
