import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { randomUUID } from 'crypto';
import { Envs } from '../../common/env/envs';
import { UserEntity } from '../database/entities/user.entity';
import { TransactionEntity } from '../database/entities/transaction.entity';
import { TelegramService } from '../telegram/telegram-service';

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
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
  ) {}

  async createBalancePaymentLink(
    userId: string,
    amount: number,
  ): Promise<{ ok: true; paymentUrl: string } | { ok: false; error: string }> {
    try {
      const shopId = (Envs.yookassa.walletNumber || '').trim();
      const secretKey = (Envs.yookassa.accessToken || '').trim();
      if (!shopId || !secretKey) {
        return {
          ok: false,
          error:
            'Оплата через YooKassa временно недоступна. Попробуйте другой способ оплаты (TON или СБП).',
        };
      }

      const user = await this.em.findOne(UserEntity, {
        where: { id: userId },
      });

      if (!user) {
        return { ok: false, error: 'Пользователь не найден' };
      }

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
            return_url: 'https://web.telegram.org/a/#7682387428',
          },
          metadata: {
            userId,
          },
        }),
      });

      if (!res.ok) {
        return {
          ok: false,
          error:
            'Не удалось создать платеж в YooKassa. Попробуйте другой способ оплаты (TON или СБП).',
        };
      }

      const payment = (await res.json()) as {
        id: string;
        status: string;
        amount: { value: string; currency: string };
        confirmation?: { type?: string; confirmation_url?: string };
        metadata?: { userId?: string };
      };

      const paymentId = payment.id;
      const paymentUrl = payment.confirmation?.confirmation_url;

      if (!paymentId || !paymentUrl) {
        return {
          ok: false,
          error:
            'Не удалось получить ссылку на оплату в YooKassa. Попробуйте другой способ оплаты.',
        };
      }

      // Сохраняем платеж в БД
      const now = Date.now();
      await this.em.save(TransactionEntity, {
        id: BigInt(now),
        userId: user.id,
        paymentId,
        amount,
        currency: 'РУБ',
        type: 'Credit',
        place: 'yookassa',
        completed: false,
        paymentUrl,
        createdAt: now,
      } as unknown as TransactionEntity);

      return {
        ok: true,
        paymentUrl,
      };
    } catch (error) {
      console.log('[YooKassa] createBalancePaymentLink exception', error);
      return {
        ok: false,
        error:
          'Оплата через YooKassa временно недоступна, используйте другие сервисы для оплаты',
      };
    }
  }

  async getPaymentByPaymentId(
    paymentId: string,
  ): Promise<TransactionEntity | null> {
    return await this.em.findOne(TransactionEntity, {
      where: { paymentId },
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

    const amount = Number(balancePayment.amount);
    await this.em
      .createQueryBuilder()
      .update(UserEntity)
      .set({ balance: () => `balance + ${amount}` })
      .where('id = :id', { id: balancePayment.userId })
      .execute();

    await this.telegramService.sendMessageAddBalance(
      balancePayment.userId,
      amount,
    );

    await this.em.update(
      TransactionEntity,
      { id: balancePayment.id },
      { completed: true as const },
    );
  }
}
