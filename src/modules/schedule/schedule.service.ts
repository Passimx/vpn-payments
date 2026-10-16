import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TonService } from '../ton/ton.service';
import { XrayService } from '../xray/xray-service';
import { TelegramService } from '../telegram/telegram-service';
import { AnalyticsService } from '../telegram/analytics.service';
import { logger } from '../../common/logger/logger';

@Injectable()
export class ScheduleService {
  private readonly runners: Set<string>;

  constructor(
    private readonly tonService: TonService,
    private readonly xrayService: XrayService,
    private readonly telegramService: TelegramService,
    private readonly analyticsService: AnalyticsService,
  ) {
    this.runners = new Set<string>();
  }

  @Cron('*/10 * * * * *')
  public async scanTonTransactions() {
    await this.rubJob(this.tonService.scanTransactions.name, () =>
      this.tonService.scanTransactions(),
    );
  }

  @Cron('*/30 * * * * *')
  public async checkExpiredKeys() {
    await this.rubJob(this.xrayService.checkExpiredKeys.name, () =>
      this.xrayService.checkExpiredKeys(),
    );
  }

  @Cron('0 */12 * * *')
  public async checkAlmostExpiredKeys() {
    await this.rubJob(
      `${this.xrayService.checkAlmostExpiredKeys.name} ${this.xrayService.notifyLowTraffic.name}`,
      async () => {
        await this.xrayService.checkAlmostExpiredKeys();
        await this.xrayService.notifyLowTraffic();
      },
    );
  }

  @Cron('0 18 * * *', {
    timeZone: 'Europe/Moscow',
  })
  public async replyUsersWithoutKeys() {
    await this.rubJob(this.telegramService.replyUsersWithoutKeys.name, () =>
      this.telegramService.replyUsersWithoutKeys(),
    );
  }

  @Cron('* * * * *')
  public async saveAnalytics() {
    await this.rubJob(this.analyticsService.saveAnalytics.name, () =>
      this.analyticsService.saveAnalytics(),
    );
  }

  @Cron('*/5 * * * *')
  public async saveTrafficAndCheckPremiumLimits() {
    await this.rubJob(
      `${this.analyticsService.saveTraffic.name} ${this.xrayService.checkPremiumTrafficLimitExceeded.name}`,
      async () => {
        await this.analyticsService.saveTraffic();
        await this.xrayService.checkPremiumTrafficLimitExceeded();
      },
    );
  }

  @Cron('* * * * *')
  public async resendMessage() {
    await this.rubJob(this.telegramService.resendMessage.name, () =>
      this.telegramService.resendMessage(),
    );
  }

  private rubJob = async (method: string, fun: () => Promise<unknown>) => {
    if (this.runners.has(method)) return;

    try {
      this.runners.add(method);
      await fun();
    } catch (e) {
      logger.error(e);
    } finally {
      this.runners.delete(method);
    }
  };
}
