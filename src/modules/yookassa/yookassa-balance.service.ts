import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { randomUUID } from 'crypto';
import { Envs } from '../../common/env/envs';
import { TransactionEntity } from '../database/entities/transaction.entity';
import { logger } from '../../common/logger/logger';
import { TransactionsService } from '../transactions/transactions.service';
import { DataResponse } from '../api/dto/responses/data-response.dto';
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
    private readonly transactionsService: TransactionsService,
  ) {}

  async createBalancePaymentLink(
    userId: string,
    amount: number,
  ): Promise<DataResponse<string>> {
    try {
      const shopId = (Envs.yookassa.walletNumber || '').trim();
      const secretKey = (Envs.yookassa.accessToken || '').trim();
      if (!shopId || !secretKey)
        return new DataResponse(
          'Оплата через YooKassa временно недоступна. Попробуйте другой способ оплаты (TON или СБП).',
        );

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
          description: `Пополнение баланса user:${userId}`,
          confirmation: {
            type: 'redirect',
            return_url: 'tg://resolve?domain=passimx_vpn_bot',
          },
          metadata: {
            userId,
          },
        }),
      });

      if (!res.ok)
        return new DataResponse(
          'Не удалось создать платеж в YooKassa. Попробуйте другой способ оплаты (TON или СБП).',
        );

      const payment = (await res.json()) as {
        id: string;
        status: string;
        amount: { value: string; currency: string };
        confirmation?: { type?: string; confirmation_url?: string };
        metadata?: { userId?: string };
      };

      const paymentId = payment.id;
      const paymentUrl = payment.confirmation?.confirmation_url;

      if (!paymentId || !paymentUrl)
        return new DataResponse(
          'Не удалось получить ссылку на оплату в YooKassa. Попробуйте другой способ оплаты.',
        );

      const now = Date.now();
      await this.em.save(TransactionEntity, {
        id: BigInt(now),
        userId,
        paymentId,
        amount,
        currency: 'rub',
        type: 'Credit',
        place: 'yookassa',
        completed: false,
        paymentUrl,
        createdAt: now,
      } as unknown as TransactionEntity);

      return new DataResponse(paymentUrl, true);
    } catch (error) {
      logger.error('[YooKassa] createBalancePaymentLink exception', error);
      return new DataResponse(
        'Оплата через YooKassa временно недоступна, используйте другие сервисы для оплаты',
      );
    }
  }

  async getPaymentByPaymentId(
    paymentId: string,
  ): Promise<TransactionEntity | null> {
    return await this.em.findOne(TransactionEntity, {
      where: { paymentId, completed: false, place: 'yookassa' },
      relations: ['user'],
    });
  }

  async handleWebhook(payload: YooKassaWebhookPayload): Promise<void> {
    if (payload?.event !== 'payment.succeeded') return;
    const payment = payload.object;
    if (!payment || payment.status !== 'succeeded') return;

    const balancePayment = await this.getPaymentByPaymentId(payment.id);
    if (!balancePayment) return;
    if (balancePayment.completed) return;

    await this.em.update(
      TransactionEntity,
      { id: balancePayment.id },
      { completed: true },
    );

    const amount = Number(balancePayment.amount);

    await this.transactionsService.addBalance(
      balancePayment.userId,
      amount,
      CurrencyEnum.RUB,
    );
  }
}
