import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TonService } from '../ton/ton.service';
import { AmneziaService } from '../amnezia/amnezia-service';
import { TelegramService } from '../telegram/telegram-service';

@Injectable()
export class ScheduleService {
  constructor(
    private readonly tonService: TonService,
    private readonly amneziaService: AmneziaService,
    private readonly telegramService: TelegramService,
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

  @Cron('0 0 */7 * *')
  public async replyUsersWithoutKeys() {
    await this.telegramService.replyUsersWithoutKeys();
  }

  @Cron('0 18 * * *')
  public async sendMessageTryFreeKey() {
    await this.telegramService.send8March();
  }
}
