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
  async scanTonTransactions() {
    await this.tonService.scanTransactions();
  }

  @Cron('0 1 * * *')
  async checkExpiredKeys() {
    console.log('start work cron "chekExpiredKeys"');
    await this.amneziaService.checkExpiredKeys();
  }
}
