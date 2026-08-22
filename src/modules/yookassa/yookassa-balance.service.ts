import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, JsonContains } from 'typeorm';
import { randomUUID } from 'crypto';
import { Envs } from '../../common/env/envs';
import { TransactionEntity } from '../database/entities/transaction.entity';
import { logger } from '../../common/logger/logger';
import { TransactionsService } from '../transactions/transactions.service';
import { CurrencyEnum } from '../transactions/types/currency.enum';

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

      const res = await fetch('https://api.yookassa.ru/v3/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotence-Key': idempotenceKey,
          Authorization: authHeader,
        },
        body: JSON.stringify({
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
        }),
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
      );

      await manager.update(
        TransactionEntity,
        { id: balancePayment.id, completed: false },
        { completed: true },
      );
    });
  }
}
