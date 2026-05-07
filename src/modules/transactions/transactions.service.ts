import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { CryptoPriceType } from './types/crypto-price.type';
import { EntityManager } from 'typeorm';
import { UserEntity } from '../database/entities/user.entity';
import { TelegramService } from '../telegram/telegram-service';
import { CurrencyType } from './types/currency.type';
import { BalanceAccount } from '../database/entities/balance-account.entity';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly em: EntityManager,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
  ) {}

  onModuleInit() {
    this.getCurrencyPrice();
  }

  private cache: CryptoPriceType | null = null;
  private readonly TTL = 10 * 60 * 1000;

  public async addBalance(
    userId: string,
    balance: number,
    currency: CurrencyType,
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

  public async getUserTotalBalance(
    balanceAccount: BalanceAccount,
    currency: string,
  ) {
    const currencyPrice = this.cache;
    if (!currencyPrice) return 0;

    let sum = 0;

    const currencyMap = {
      rub: 'rub',
      cny: 'cny',
      ton: 'the-open-network',
      tonUsdt: 'usd',
    };

    for (const [key, value] of Object.entries(balanceAccount)) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const fromCurrency = currencyMap[key];
      if (!fromCurrency) continue;

      const converted = await this.convert(value, fromCurrency, currency);
      sum += converted;
    }

    return Math.floor(sum * 100) / 100;
  }

  public async decreaseBalance(
    userId: string,
    amount: number,
    currency: CurrencyType | 'the-open-network',
    manager: EntityManager,
  ): Promise<boolean> {
    const balanceAccount = await manager.findOneOrFail(BalanceAccount, {
      where: { userId },
    });

    const currencyPrice = await this.getCurrencyPrice();
    if (!currencyPrice) return false;

    if (amount > 0 && balanceAccount.rub > 0) {
      amount = await this.convert(amount, currency, 'rub');
      currency = 'rub';

      if (balanceAccount.rub >= amount) {
        balanceAccount.rub -= amount;
        amount = 0;
      } else {
        amount -= balanceAccount.rub;
        balanceAccount.rub = 0;
      }
    }

    if (amount > 0 && balanceAccount.cny) {
      amount = await this.convert(amount, currency, 'cny');
      currency = 'cny';

      if (balanceAccount.cny >= amount) {
        balanceAccount.cny -= amount;
        amount = 0;
      } else {
        amount -= balanceAccount.cny;
        balanceAccount.cny = 0;
      }
    }

    if (amount > 0 && balanceAccount.ton) {
      amount = await this.convert(amount, currency, 'the-open-network');
      currency = 'the-open-network';

      if (balanceAccount.ton >= amount) {
        balanceAccount.ton -= amount;
        amount = 0;
      } else {
        amount -= balanceAccount.ton;
        balanceAccount.ton = 0;
      }
    }

    if (amount > 0 && balanceAccount.tonUsdt) {
      amount = await this.convert(amount, currency, 'usd');
      // currency = 'usd';

      if (balanceAccount.tonUsdt >= amount) {
        balanceAccount.tonUsdt -= amount;
        amount = 0;
      } else {
        amount -= balanceAccount.tonUsdt;
        balanceAccount.tonUsdt = 0;
      }
    }

    if (amount > 0) return false;
    await manager.save(balanceAccount);

    return true;
  }

  public async convert(amount: number, from: string, to: string) {
    const currencyPrice = await this.getCurrencyPrice();
    if (!currencyPrice) return 0;

    let result = 0;

    if (from === to) result = amount;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    else if (currencyPrice[from]?.[to]) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      result = amount * currencyPrice[from][to];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    } else if (currencyPrice[to]?.[from]) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      result = amount / currencyPrice[to][from];
    } else if (from !== 'usd' && to !== 'usd') {
      const inUsd = await this.convert(amount, from, 'usd');
      result = await this.convert(inUsd, 'usd', to);
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
}
