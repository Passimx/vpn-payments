import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { UserEntity } from '../database/entities/user.entity';
import { PaymentsEntity } from '../database/entities/balance-debit.entity';
import { AnalyticEntity } from '../database/entities/analytic.entity';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { UserKeyEntity } from '../database/entities/user-key.entity';
import { TelegramService } from './telegram-service';
import { Context } from 'telegraf';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly em: EntityManager,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
  ) {}

  public async saveAnalytics() {
    const [allUsersCount, newUsersCount, activeUsersCount, activeKeysCount] =
      await Promise.all([
        this.em.createQueryBuilder(UserEntity, 'users').getCount(),
        this.em
          .createQueryBuilder(UserEntity, 'users')
          .where('users."created_at"::DATE = CURRENT_DATE')
          .getCount(),
        this.em
          .createQueryBuilder(UserEntity, 'users')
          .innerJoin('users.keys', 'keys', 'keys.expiresAt > CURRENT_DATE')
          .getCount(),
        this.em
          .createQueryBuilder(UserKeyEntity, 'keys')
          .where('keys.expiresAt > CURRENT_DATE')
          .getCount(),
      ]);

    const paymentsSum = Number(
      (await this.em
        .createQueryBuilder(PaymentsEntity, 'payments')
        .select('COALESCE(SUM(payments.amount), 0)', 'sum')
        .where('payments."created_at"::DATE = CURRENT_DATE')
        .getRawOne<{ sum: string }>())!.sum,
    );

    await this.em.upsert(
      AnalyticEntity,
      {
        createdAt: () => 'CURRENT_DATE',
        allUsersCount,
        activeUsersCount,
        newUsersCount,
        paymentsSum,
        activeKeysCount,
      },
      { conflictPaths: ['createdAt'] },
    );
  }

  public sendAnalytics = async (ctx: Context) => {
    if (ctx.from?.id !== 904644377 && ctx.from?.id !== 871909427) return;

    const analytics = await this.em
      .createQueryBuilder(AnalyticEntity, 'analytics')
      .orderBy('analytics.createdAt', 'ASC')
      .where("analytics.createdAt > CURRENT_DATE - interval '1 month'")
      .getMany();

    const chartJSNodeCanvas = new ChartJSNodeCanvas({
      width: 1200,
      height: 600,
      backgroundColour: 'white',
    });

    const usersChart = await chartJSNodeCanvas.renderToBuffer({
      type: 'line',
      data: {
        labels: analytics.map(({ createdAt }) =>
          createdAt.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: '2-digit',
          }),
        ),
        datasets: [
          {
            label: 'Рост активных пользователей',
            data: analytics.map(
              (a) => (a.activeUsersCount / a.allUsersCount) * 100,
            ),
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59,130,246,0.15)',
            tension: 0.3,
          },
          {
            label: 'Рост новых пользователей',
            data: analytics.map((a) => {
              const base = a.allUsersCount - a.newUsersCount;

              if (base === 0) return 0;

              return (a.newUsersCount / base) * 100;
            }),
            borderColor: '#10b981',
            backgroundColor: 'rgba(16,185,129,0.15)',
            tension: 0.3,
          },
        ],
      },
      options: {
        scales: {
          x: {
            ticks: {
              color: '#000',
            },
            title: {
              display: true,
              text: 'Дата',
              color: '#000',
            },
          },
          y: {
            max: 100,
            min: 0,
            ticks: {
              color: '#000',
            },
            title: {
              display: true,
              text: 'Конверсия (%) пользователей',
              color: '#000',
            },
          },
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: '#000',
            },
          },
          title: {
            display: true,
            text: '📊 Статистика пользователей',
            color: '#000',
          },
        },
      },
    });

    const paymentsChart = await chartJSNodeCanvas.renderToBuffer({
      type: 'line',
      data: {
        labels: analytics.map((a) =>
          a.createdAt.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: '2-digit',
          }),
        ),
        datasets: [
          {
            label: 'Оплата в день',
            data: analytics.map((a) => a.paymentsSum),
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59,130,246,0.15)',
            tension: 0.3,
          },
        ],
      },
      options: {
        scales: {
          x: {
            ticks: {
              color: '#000',
            },
            title: {
              display: true,
              text: 'Дата',
              color: '#000',
            },
          },
          y: {
            ticks: {
              color: '#000',
            },
            title: {
              display: true,
              text: 'Сумма (руб.)',
              color: '#000',
            },
          },
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: '#000',
            },
          },
          title: {
            display: true,
            text: '📊 Статистика оплаты',
            color: '#000',
          },
        },
      },
    });

    await this.telegramService.bot.telegram.sendPhoto(
      ctx.chat!.id,
      {
        source: usersChart,
      },
      { caption: 'Конверсия (%) пользователей' },
    );

    await this.telegramService.bot.telegram.sendPhoto(
      ctx.chat!.id,
      {
        source: paymentsChart,
      },
      { caption: '📊 Статистика оплаты' },
    );
  };
}
