import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { CryptoPriceType } from './types/crypto-price.type';
import { EntityManager } from 'typeorm';
import { UserEntity } from '../database/entities/user.entity';
import { TelegramService } from '../telegram/telegram-service';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly em: EntityManager,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
  ) {}

  private cache: CryptoPriceType | null = null;
  private readonly TTL = 10 * 60 * 1000;

  public async addBalance(userId: string, addBalance: number) {
    await this.em
      .createQueryBuilder()
      .update(UserEntity)
      .set({
        balance: () => `balance + ${addBalance}`,
      })
      .where('id = :id', { id: userId })
      .execute();

    await this.telegramService.sendMessageAddBalance(userId, addBalance);

    const user = await this.em.findOneOrFail(UserEntity, {
      where: { id: userId },
    });

    if (!user.source) return;

    const diffInMs = Math.abs(
      new Date().getTime() - new Date(user.createdAt).getTime(),
    );
    const daysDiff = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
    if (daysDiff > 90) return;

    const amount = Math.floor(addBalance * 0.3);
    if (amount > 0) await this.addBalance(user.source, amount);
  }

  // получение актуального курса криптовалют
  public async getCurrencyPrice() {
    if (this.cache) return this.cache;

    const date = new Date();
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Месяцы 0-11
    const year = date.getFullYear();
    const formattedDate = `${day}-${month}-${year}`;

    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=the-open-network,ethereum,bitcoin,solana,usd&vs_currencies=usd,rub,cny,eur&date=${formattedDate}&localization=false`,
    ).catch(() => {});
    if (!response) return;

    this.cache = (await response.json()) as CryptoPriceType;
    setTimeout(() => {
      this.cache = null;
    }, this.TTL);

    return this.cache;
  }
}
