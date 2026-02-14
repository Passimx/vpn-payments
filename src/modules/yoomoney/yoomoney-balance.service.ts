import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { buildQuickpayUrl } from './yoomoney-quickpay';
import { Envs } from '../../common/env/envs';
import { YooMoneyBalancePaymentEntity } from '../database/entities/yoomoney-balance.entity';
import { YooMoneyIncomingEntity } from '../database/entities/yoomoney-incoming.entity';
import { UserEntity } from '../database/entities/user.entity';

@Injectable()
export class YooMoneyBalanceService {
  private readonly walletNumber: string;

  constructor(private readonly em: EntityManager) {
    this.walletNumber = Envs.yoomoney.walletNumber || '4100119473106556';
  }

  async createBalancePaymentLink(
    userId: string,
    amount: number,
  ): Promise<{ ok: true; paymentUrl: string } | { ok: false; error: string }> {
    try {
      const user = await this.em.findOne(UserEntity, {
        where: { id: userId },
      });

      if (!user) {
        return { ok: false, error: 'Пользователь не найден' };
      }

      const label = userId;

      const paymentUrl = buildQuickpayUrl({
        receiver: this.walletNumber,
        sum: amount,
        targets: 'Пополнение баланса',
        paymentType: 'SB',
        label,
      });

      // Сохраняем платеж в БД
      await this.em.save(YooMoneyBalancePaymentEntity, {
        userId: user.id,
        label: label,
        amount: amount,
        status: 'pending',
        paymentUrl: paymentUrl,
      });

      return {
        ok: true,
        paymentUrl: paymentUrl,
      };
    } catch {
      return {
        ok: false,
        error: 'Серви Yoomoney покачто не работает, используйте другие сервисы для оплаты (ТОН или СПБ)',
      };
    }
  }

  async getPaymentByLabel(label: string): Promise<YooMoneyBalancePaymentEntity | null> {
    return await this.em.findOne(YooMoneyBalancePaymentEntity, {
      where: { label },
      relations: ['user'],
    });
  }

  async fetchIncomingAndLog(): Promise<void> {
    const token = (Envs.yoomoney.accessToken || '').trim();
    if (!token) return;

    const res = await fetch('https://yoomoney.ru/api/operation-history', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'records=100',
    });
    if (!res.ok) return;

    const data = (await res.json()) as {
      error?: string;
      operations?: Array<{
        operation_id: string;
        status: string;
        direction: string;
        amount: number;
        datetime: string;
        title: string;
        label?: string;
      }>;
    };
    if (data.error) return;

    for (const op of data.operations ?? []) {
      if (op.direction !== 'in' || op.status !== 'success') continue;

      const exists = await this.em.findOne(YooMoneyIncomingEntity, {
        where: { operationId: op.operation_id },
      });
      if (!exists) {
        await this.em.save(YooMoneyIncomingEntity, {
          operationId: op.operation_id,
          amount: op.amount,
          datetime: new Date(op.datetime),
          label: op.label ?? null,
          title: op.title ?? null,
          status: op.status,
        });
      }

      if (!op.label) continue;
      const payment = await this.getPaymentByLabel(op.label);
      if (!payment || payment.status !== 'pending') continue;
      const amount = Number(payment.amount);
      await this.em
        .createQueryBuilder()
        .update(UserEntity)
        .set({ balance: () => `balance + ${amount}` })
        .where('id = :id', { id: payment.userId })
        .execute();
      await this.em.update(
        YooMoneyBalancePaymentEntity,
        { id: payment.id },
        { status: 'paid' as const },
      );
    }
  }
}
