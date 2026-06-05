import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { UserEntity } from '../database/entities/user.entity';
import { PaymentsEntity } from '../database/entities/payment.entity';
import { AnalyticEntity } from '../database/entities/analytic.entity';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { UserKeyEntity } from '../database/entities/user-key.entity';
import { TelegramService } from './telegram-service';
import { Context } from 'telegraf';
import { ServerEntity } from '../database/entities/server.entity';
import { XrayService } from '../xray/xray-service';
import { logger } from '../../common/logger/logger';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly em: EntityManager,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    private readonly xrayService: XrayService,
  ) {}

  public async saveAnalytics() {
    const [allUsersCount, newUsersCount, activeUsersCount, activeKeysCount] =
      await Promise.all([
        this.em.createQueryBuilder(UserEntity, 'users').getCount(),
        this.em
          .createQueryBuilder(UserEntity, 'users')
          .where(
            `(users."created_at" AT TIME ZONE 'Europe/Moscow')::DATE = DATE(NOW() AT TIME ZONE 'Europe/Moscow')`,
          )
          .getCount(),
        this.em
          .createQueryBuilder(UserEntity, 'users')
          .innerJoin(
            'users.keys',
            'keys',
            `keys.expiresAt > DATE(NOW() AT TIME ZONE 'Europe/Moscow')`,
          )
          .getCount(),
        this.em
          .createQueryBuilder(UserKeyEntity, 'keys')
          .where(`keys.expiresAt > DATE(NOW() AT TIME ZONE 'Europe/Moscow')`)
          .getCount(),
      ]);

    const paymentsSum = Number(
      (await this.em
        .createQueryBuilder(PaymentsEntity, 'payments')
        .select('COALESCE(SUM(payments.amount), 0)', 'sum')
        .where(
          `payments."created_at"::DATE = DATE(NOW() AT TIME ZONE 'Europe/Moscow')`,
        )
        .getRawOne<{ sum: string }>())!.sum,
    );

    await this.em.upsert(
      AnalyticEntity,
      {
        createdAt: () => "DATE(NOW() AT TIME ZONE 'Europe/Moscow')",
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
      .where(
        `analytics.createdAt > DATE(NOW() AT TIME ZONE 'Europe/Moscow') - interval '1 month'`,
      )
      .getMany();

    const chartJSNodeCanvas = new ChartJSNodeCanvas({
      width: 1200,
      height: 600,
      backgroundColour: 'white',
    });

    const paymentsChart = await chartJSNodeCanvas.renderToBuffer({
      type: 'line',
      data: {
        labels: analytics.map((a) => {
          const date = new Date(a.createdAt);

          return new Intl.DateTimeFormat('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            timeZone: 'Europe/Moscow',
          }).format(date);
        }),
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

    await this.telegramService.bot.telegram
      .sendPhoto(
        ctx.chat!.id,
        {
          source: paymentsChart,
        },
        { caption: '📊 Статистика оплаты' },
      )
      .catch(logger.error);
  };

  public async saveTraffic() {
    const servers = await this.em.find(ServerEntity, {
      where: { canCreateKey: true },
    });

    for (const server of servers) {
      const stats = await this.xrayService.getStats(server);
      if (!stats?.length) continue;

      for (const stat of stats) {
        try {
          await this.em.query(
            `INSERT INTO traffics (key_id, server_id, up_link, down_link, updated_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (key_id, server_id)
             DO UPDATE SET
               up_link    = traffics.up_link + EXCLUDED.up_link,
               down_link  = traffics.down_link + EXCLUDED.down_link,
               updated_at = NOW()`,
            [stat.id, server.id, stat.uplink, stat.downlink],
          );
        } catch (e) {
          logger.error(
            `При получении трафика, не был найден ключ ${stat.id} с сервера ${server.id}`,
            e,
          );
        }
      }
    }
  }
}
