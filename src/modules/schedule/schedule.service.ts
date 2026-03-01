import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TonService } from '../ton/ton.service';
import { AmneziaService } from '../amnezia/amnezia-service';

@Injectable()
export class ScheduleService {
  constructor(
    private readonly tonService: TonService,
    private readonly amneziaService: AmneziaService,
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
}
