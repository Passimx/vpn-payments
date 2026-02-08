import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TransactionEntity } from '../database/entities/transaction.entity';
import { TransactionResponseType } from './types/transaction-response.type';
import { TBankEntity } from '../database/entities/t-bank.entity';
import { HeadersInit } from 'undici-types/fetch';

const appName = 'supreme';
const appVersion = 'release-2.47.185-repeat-10e75457';

@Injectable()
export class TBankService {
  private tBankEntity: TBankEntity | null;

  constructor(private readonly em: EntityManager) {}

  async onModuleInit() {
    const tBankEntity = await this.em.findOne(TBankEntity, { where: {} });
    if (tBankEntity) this.tBankEntity = tBankEntity;
  }

  public async scanTransactions(): Promise<void> {
    const [transaction] = await this.em.find(TransactionEntity, {
      where: { place: 't_bank' },
      order: { createdAt: 'DESC' },
      take: 1,
    });

    const start = transaction?.createdAt ?? 1767225600000;
    const response = await this.getTBankOperations(start + 1);

    if (!response?.payload?.length) return;

    const transactions = response.payload
      .map(
        (payload) =>
          ({
            id: BigInt(payload.id),
            amount: payload.amount.value,
            currency: 'РУБ',
            message: payload.message,
            type: payload.type,
            place: 't_bank',
            createdAt: payload.operationTime.milliseconds,
          }) as TransactionEntity,
      )
      .filter(
        (transactionEntity) => transactionEntity?.id || 0 > transaction.id,
      );

    await this.em.insert(TransactionEntity, transactions);
  }

  private async getTBankOperations(start: number) {
    const response = await fetch(
      `https://www.tbank.ru/api/common/v1/operations?appName=${appName}&appVersion=${appVersion}&sessionid=${this.tBankEntity?.sessionId}&start=${start}`,
      {
        headers: this.getHeaders() as unknown as { accept: string },
        method: 'GET',
      },
    );

    if (response.status !== 200) return;

    const result = response.json() as unknown as TransactionResponseType;
    if (result.resultCode === 'OK') return result;
    console.log('403');
  }

  private getHeaders() {
    return {
      accept: '*/*',
      'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      'content-type': 'application/json',
      priority: 'u=1, i',
      'sec-ch-ua':
        '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
      'sec-ch-ua-arch': '""',
      'sec-ch-ua-mobile': '?1',
      'sec-ch-ua-model': '"Nexus 5"',
      'sec-ch-ua-platform': '"Android"',
      'sec-ch-ua-platform-version': '"6.0"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      cookie: this.tBankEntity?.cookie,
      Referer: 'https://www.tbank.ru/mybank/operations/',
    } as HeadersInit;
  }
}
