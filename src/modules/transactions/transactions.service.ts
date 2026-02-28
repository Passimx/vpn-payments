import { Injectable } from '@nestjs/common';
import { CryptoPriceType } from './types/crypto-price.type';

@Injectable()
export class TransactionsService {
  private cache: CryptoPriceType | null = null;
  private readonly TTL = 10 * 60 * 1000;

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
