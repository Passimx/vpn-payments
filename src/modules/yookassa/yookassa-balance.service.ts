import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, JsonContains, MoreThan } from 'typeorm';
import { randomUUID } from 'crypto';
import { Envs } from '../../common/env/envs';
import { TransactionEntity } from '../database/entities/transaction.entity';
import { logger } from '../../common/logger/logger';
import { TransactionsService } from '../transactions/transactions.service';
import { CurrencyEnum } from '../transactions/types/currency.enum';
import { ProxyAgent, fetch } from 'undici';

const yookassaProxy = new ProxyAgent('http://217.177.11.88:8888');

export type YooKassaWebhookPayload = {
  event?: string;
  object?: {
    id: string;
    status: string;
    amount: { value: string; currency: string };
    metadata?: { userId?: string };
  };
};

@Injectable()
export class YookassaBalanceService {
  constructor(
    private readonly em: EntityManager,
    private readonly dataSource: DataSource,
    private readonly transactionsService: TransactionsService,
  ) {}

  async createInvoice(
    userId: string,
    amount: number,
  ): Promise<string | undefined> {
    try {
      const shopId = (Envs.yookassa.walletNumber || '').trim();
      const secretKey = (Envs.yookassa.accessToken || '').trim();
      if (!shopId || !secretKey) return;

      const idempotenceKey = randomUUID();
      const authHeader =
        'Basic ' +
        Buffer.from(`${shopId}:${secretKey}`, 'utf8').toString('base64');
      const headers = {
        'Content-Type': 'application/json',
        'Idempotence-Key': idempotenceKey,
        Authorization: authHeader,
      };
      const body: string = JSON.stringify({
        amount: {
          value: amount.toFixed(2),
          currency: 'RUB',
        },
        capture: true,
        description: `user:${userId}`,
        confirmation: {
          type: 'redirect',
          return_url: 'tg://resolve?domain=passimx_vpn_bot',
        },
        metadata: {
          userId,
        },
      });

      const res = await fetch('https://api.yookassa.ru/v3/payments', {
        method: 'POST',
        dispatcher: yookassaProxy,
        headers,
        body,
      });

      if (!res.ok) return;

      const payment = (await res.json()) as {
        id: string;
        status: string;
        amount: { value: string; currency: string };
        confirmation?: { type?: string; confirmation_url?: string };
        metadata?: { userId?: string };
      };

      const paymentId = payment.id;
      const paymentUrl = payment.confirmation?.confirmation_url;

      if (!paymentId || !paymentUrl) return;

      await this.em.save(TransactionEntity, {
        userId,
        amount,
        currency: CurrencyEnum.RUB,
        type: 'Credit',
        kind: 'Deposit',
        completed: false,
        meta: {
          paymentId,
          place: 'yookassa',
        },
      } as TransactionEntity);

      return paymentUrl;
    } catch (error) {
      logger.error('[YooKassa] createBalancePaymentLink exception', error);
    }
  }

  async getPaymentByPaymentId(
    paymentId: string,
  ): Promise<TransactionEntity | null> {
    return await this.em.findOne(TransactionEntity, {
      where: { meta: JsonContains({ paymentId }), completed: false },
      relations: ['user'],
    });
  }

  async scanPendingPayments(): Promise<void> {
    const pending = await this.em.find(TransactionEntity, {
      where: {
        completed: false,
        createdAt: MoreThan(new Date(Date.now() - 60 * 60 * 1000)),
        meta: JsonContains({ place: 'yookassa' }),
      },
    });

    const shopId = (Envs.yookassa.walletNumber || '').trim();
    const secretKey = (Envs.yookassa.accessToken || '').trim();
    if (!shopId || !secretKey) return;

    const authHeader =
      'Basic ' +
      Buffer.from(`${shopId}:${secretKey}`, 'utf8').toString('base64');

    for (const transaction of pending) {
      const paymentId = (transaction.meta as { paymentId?: string } | undefined)
        ?.paymentId;
      if (!paymentId) continue;

      const res = await fetch(
        `https://api.yookassa.ru/v3/payments/${paymentId}`,
        {
          dispatcher: yookassaProxy,
          headers: { Authorization: authHeader },
        },
      );
      if (!res.ok) continue;

      const payment = (await res.json()) as { id: string; status: string };
      if (payment.status !== 'succeeded') continue;

      await this.handleWebhook({
        event: 'payment.succeeded',
        object: {
          id: payment.id,
          status: payment.status,
          amount: { value: String(transaction.amount), currency: 'RUB' },
        },
      });
    }
  }

  async handleWebhook(payload: YooKassaWebhookPayload): Promise<void> {
    if (payload?.event !== 'payment.succeeded') return;
    const payment = payload.object;
    if (!payment || payment.status !== 'succeeded') return;

    const balancePayment = await this.getPaymentByPaymentId(payment.id);
    if (!balancePayment) return;

    const amount = Number(balancePayment.amount);

    await this.dataSource.transaction(async (manager) => {
      await this.transactionsService.addBalance(
        balancePayment.userId,
        amount,
        CurrencyEnum.RUB,
        manager,
        true,
      );

      await manager.update(
        TransactionEntity,
        { id: balancePayment.id, completed: false },
        { completed: true },
      );
    });
  }
}
