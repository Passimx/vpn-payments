import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TonService } from '../ton/ton.service';
import { AmneziaService } from '../amnezia/amnezia-service';
import { TelegramService } from '../telegram/telegram-service';
import { AnalyticsService } from '../telegram/analytics.service';

@Injectable()
export class ScheduleService {
  constructor(
    private readonly tonService: TonService,
    private readonly amneziaService: AmneziaService,
    private readonly telegramService: TelegramService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  @Cron('* * * * *')
  public async scanTonTransactions() {
    await this.tonService.scanTransactions();
  }

  @Cron('*/30 * * * * *')
  public async checkExpiredKeys() {
    await this.amneziaService.checkExpiredKeys();
  }

  @Cron('0 */12 * * *')
  public async checkAlmostExpiredKeys() {
    await this.amneziaService.checkAlmostExpiredKeys();
  }

  @Cron('0 18 * * *', {
    timeZone: 'Europe/Moscow',
  })
  public async replyUsersWithoutKeys() {
    await this.telegramService.replyUsersWithoutKeys();
  }

  @Cron('59 23 * * *')
  public async saveAnalytics() {
    await this.analyticsService.saveAnalytics();
  }

  @Cron('0 8 * * *', {
    timeZone: 'Europe/Moscow',
  })
  public async sendAnalytics() {
    await this.analyticsService.sendAnalytics();
  }

  // @Cron('30 * * * *')
  // async sendMessageEveryOne() {
  //   await this.telegramService.sendMessageEveryOne(
  //     'message_new_feature_change_countries',
  //   );
  // }
}
