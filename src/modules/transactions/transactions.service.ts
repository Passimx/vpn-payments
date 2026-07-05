import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { CryptoPriceType } from './types/crypto-price.type';
import { EntityManager } from 'typeorm';
import { UserEntity } from '../database/entities/user.entity';
import { TelegramService } from '../telegram/telegram-service';
import { CurrencyEnum } from './types/currency.enum';
import { BalanceAccount } from '../database/entities/balance-account.entity';
import { logger } from '../../common/logger/logger';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly em: EntityManager,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
  ) {}

  onModuleInit() {
    void this.getCurrencyPrice();
  }

  private cache: CryptoPriceType | null = null;
  private readonly TTL = 10 * 60 * 1000;

  public async addBalance(
    userId: string,
    balance: number,
    currency: CurrencyEnum,
  ) {
    await this.em
      .createQueryBuilder()
      .update(BalanceAccount)
      .set({
        [currency]: () => `${currency} + ${balance}`,
      })
      .where('user_id = :userId', { userId })
      .execute();

    await this.telegramService.sendMessageAddBalance(userId, balance, currency);

    const user = await this.em.findOneOrFail(UserEntity, {
      where: { id: userId },
    });

    if (!user.source) return;
    const userEntity = await this.em.findOne(UserEntity, {
      where: { id: user.source },
    });
    if (!userEntity) return;

    const diffInMs = Math.abs(
      new Date().getTime() - new Date(user.createdAt).getTime(),
    );
    const daysDiff = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
    if (daysDiff > 90) return;

    const amount = Math.floor(balance * 0.3);
    if (amount > 0) await this.addBalance(user.source, amount, currency);
  }

  public async getCurrencyPrice() {
    if (this.cache) return this.cache;

    const [cbrCurrencyBase, cryptoCurrencyBase] = await Promise.all([
      this.getCBRCurrencyBase(),
      this.getCryptoCurrencyBase(),
    ]);

    if (!cbrCurrencyBase || !cryptoCurrencyBase) return;

    const usdInRub = cbrCurrencyBase.usdCurrency.rate;
    const cnyInRub = cbrCurrencyBase.cnyCurrency.rate;
    const tonInUsd = cryptoCurrencyBase.ton.usd;

    const priceInUsd = {
      usd: 1,
      cny: cnyInRub / usdInRub,
      rub: 1 / usdInRub,
      ton: tonInUsd,
    };

    this.cache = {
      usd: {
        usd: 1,
        cny: priceInUsd.usd / priceInUsd.cny,
        rub: priceInUsd.usd / priceInUsd.rub,
        ton: priceInUsd.usd / priceInUsd.ton,
      },
      cny: {
        usd: priceInUsd.cny / priceInUsd.usd,
        cny: 1,
        rub: priceInUsd.cny / priceInUsd.rub,
        ton: priceInUsd.cny / priceInUsd.ton,
      },
      rub: {
        usd: priceInUsd.rub / priceInUsd.usd,
        cny: priceInUsd.rub / priceInUsd.cny,
        rub: 1,
        ton: priceInUsd.rub / priceInUsd.ton,
      },
      ton: {
        usd: priceInUsd.ton / priceInUsd.usd,
        cny: priceInUsd.ton / priceInUsd.cny,
        rub: priceInUsd.ton / priceInUsd.rub,
        ton: 1,
      },
    };

    setTimeout(() => {
      this.cache = null;
    }, this.TTL);

    return this.cache;
  }

  public async getUserTotalBalance(
    balanceAccount: BalanceAccount,
    currency: CurrencyEnum,
  ) {
    const currencyPrice = this.cache;
    if (!currencyPrice) return 0;
    let sum = 0;

    for (const [key, value] of Object.entries(balanceAccount)) {
      const isValid = Object.values(CurrencyEnum).includes(key as CurrencyEnum);
      if (value === 0 || !isValid) continue;

      const converted = await this.convert(
        Number(value),
        key as CurrencyEnum,
        currency,
      );
      sum += converted;
    }

    return Math.floor(sum * 100) / 100;
  }

  public async decreaseBalance(
    userId: string,
    amount: number,
    currency: CurrencyEnum,
    manager: EntityManager,
  ): Promise<boolean> {
    const balanceAccount = await manager.findOneOrFail(BalanceAccount, {
      where: { userId },
    });

    const currencyPrice = await this.getCurrencyPrice();
    if (!currencyPrice) return false;

    if (amount > 0 && balanceAccount.rub > 0) {
      amount = await this.convert(amount, currency, CurrencyEnum.RUB);
      currency = CurrencyEnum.RUB;

      if (balanceAccount.rub >= amount) {
        balanceAccount.rub -= amount;
        amount = 0;
      } else {
        amount -= balanceAccount.rub;
        balanceAccount.rub = 0;
      }
    }

    if (amount > 0 && balanceAccount.cny) {
      amount = await this.convert(amount, currency, CurrencyEnum.CNY);
      currency = CurrencyEnum.CNY;

      if (balanceAccount.cny >= amount) {
        balanceAccount.cny -= amount;
        amount = 0;
      } else {
        amount -= balanceAccount.cny;
        balanceAccount.cny = 0;
      }
    }

    if (amount > 0 && balanceAccount.ton) {
      amount = await this.convert(amount, currency, CurrencyEnum.TON);
      currency = CurrencyEnum.TON;

      if (balanceAccount.ton >= amount) {
        balanceAccount.ton -= amount;
        amount = 0;
      } else {
        amount -= balanceAccount.ton;
        balanceAccount.ton = 0;
      }
    }

    if (amount > 0 && balanceAccount.usd) {
      amount = await this.convert(amount, currency, CurrencyEnum.USD);
      // currency = 'usd';

      if (balanceAccount.usd >= amount) {
        balanceAccount.usd -= amount;
        amount = 0;
      } else {
        amount -= balanceAccount.usd;
        balanceAccount.usd = 0;
      }
    }

    if (amount > 0) return false;
    await manager.save(balanceAccount);

    return true;
  }

  public async convert(amount: number, from: CurrencyEnum, to: CurrencyEnum) {
    const currencyPrice = await this.getCurrencyPrice();
    if (!currencyPrice) return 0;

    let result = 0;

    if (from === to) result = amount;
    else if (currencyPrice[from]?.[to]) {
      result = amount * currencyPrice[from][to];
    } else if (currencyPrice[to]?.[from]) {
      result = amount / currencyPrice[to][from];
    } else if (from !== CurrencyEnum.USD && to !== CurrencyEnum.USD) {
      const inUsd = await this.convert(amount, from, CurrencyEnum.USD);
      result = await this.convert(inUsd, CurrencyEnum.USD, to);
    }

    return Math.floor(result * 100) / 100;
  }

  public formatNumber(value: number, symdol: string) {
    const result = value.toLocaleString('ru-RU', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    return `${result} ${symdol}`;
  }

  private async getCryptoCurrencyBase() {
    try {
      const date = new Date();
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0'); // Месяцы 0-11
      const year = date.getFullYear();
      const formattedDate = `${day}-${month}-${year}`;

      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=the-open-network,ethereum,bitcoin,solana,usd&vs_currencies=usd,rub,cny,eur&date=${formattedDate}&localization=false`,
      ).catch(() => {});
      if (!response) return;
      const data = (await response.json()) as Partial<{
        'the-open-network': { usd: number };
        ton: { usd: number };
        bitcoin: { usd: number };
        ethereum: { usd: number };
        solana: { usd: number };
      }>;

      data.ton = data['the-open-network'];
      delete data['the-open-network'];

      return data as {
        ton: { usd: number };
        bitcoin: { usd: number };
        ethereum: { usd: number };
        solana: { usd: number };
      };
    } catch (e) {
      logger.error(e);
      return;
    }
  }

  private async getCBRCurrencyBase() {
    try {
      const response = await fetch('https://www.cbr.ru/currency_base/daily/');
      const html = await response.text();

      const rows = [
        ...html.matchAll(
          /<tr>\s*<td>(\d+)<\/td>\s*<td>([A-Z]+)<\/td>\s*<td>(\d+)<\/td>\s*<td>(.*?)<\/td>\s*<td>([\d,]+)<\/td>\s*<\/tr>/gs,
        ),
      ];

      const currencies = rows.map((match) => ({
        numericCode: match[1],
        charCode: match[2],
        units: Number(match[3]),
        name: match[4].trim(),
        rate: Number(match[5].replace(',', '.')),
      }));

      const cnyCurrency = currencies.find(
        (currency) => currency.charCode === 'CNY',
      );
      const usdCurrency = currencies.find(
        (currency) => currency.charCode === 'USD',
      );

      if (!cnyCurrency || !usdCurrency) return;

      return { cnyCurrency, usdCurrency };
    } catch (e) {
      logger.error(e);
      return;
    }
  }
}
