import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { CryptoPriceType } from './types/crypto-price.type';
import { EntityManager } from 'typeorm';
import { TelegramService } from '../telegram/telegram-service';
import { CurrencyEnum } from './types/currency.enum';
import {
  BalanceAccount,
  precision,
  scale,
} from '../database/entities/balance-account.entity';
import { logger } from '../../common/logger/logger';
import BigNumber from 'bignumber.js';
import { PriceType } from './types/price.type';

@Injectable()
export class TransactionsService {
  public static telegramStarsRate = 0.015;

  constructor(
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
  ) {}

  onModuleInit() {
    void this.getCurrencyPrice();
  }

  private cache: CryptoPriceType | null = null;
  private readonly TTL = 60 * 60 * 1000;

  public async addBalance(
    userId: string,
    balance: number,
    currency: CurrencyEnum,
    manager: EntityManager,
    notifyTg: boolean = false,
  ) {
    await manager
      .createQueryBuilder()
      .update(BalanceAccount)
      .set({
        [currency]: () => `${currency} + ${balance}`,
      })
      .where('user_id = :userId', { userId })
      .execute();

    if (notifyTg)
      await this.telegramService.sendMessageAddBalance(
        userId,
        balance,
        currency,
      );
  }

  public decreaseBalance(
    userId: string,
    amount: number,
    currency: CurrencyEnum,
    manager: EntityManager,
  ) {
    return manager
      .createQueryBuilder()
      .update(BalanceAccount)
      .set({
        [currency]: () => `${currency} - ${amount}`,
        seqno: () => 'seqno + 1',
      })
      .where('user_id = :userId', { userId })
      .execute();
  }

  public async decreaseBalanceFromAll(
    balanceAccount: BalanceAccount,
    amount: number,
    currency: CurrencyEnum,
    manager: EntityManager,
  ): Promise<boolean> {
    const clonedBalanceAccount = structuredClone(balanceAccount);

    const currencyPrice = await this.getCurrencyPrice();
    if (!currencyPrice) return false;

    const currencyOrder: CurrencyEnum[] = [
      CurrencyEnum.RUB,
      CurrencyEnum.CNY,
      CurrencyEnum.USD,
      CurrencyEnum.TON,
      CurrencyEnum.ETHEREUM,
      CurrencyEnum.BITCOIN,
    ];

    let remainingAmount = new BigNumber(amount);

    for (const targetCurrency of currencyOrder) {
      if (remainingAmount.isLessThanOrEqualTo(0)) break;

      const currentBalance = new BigNumber(
        clonedBalanceAccount[targetCurrency] || 0,
      );
      if (currentBalance.isLessThanOrEqualTo(0)) continue;

      const convertResult = await this.convert(
        remainingAmount.toNumber(),
        currency,
        targetCurrency as unknown as CurrencyEnum,
      );
      if (!convertResult) return false;

      const neededInTargetCurrency = new BigNumber(convertResult);

      if (currentBalance.isGreaterThanOrEqualTo(neededInTargetCurrency)) {
        const updatedBalance = currentBalance.minus(neededInTargetCurrency);
        clonedBalanceAccount[targetCurrency] = updatedBalance.toNumber();

        remainingAmount = new BigNumber(0);
      } else {
        clonedBalanceAccount[targetCurrency] = 0;

        const leftoverInTarget = neededInTargetCurrency.minus(currentBalance);
        const leftoverInSrcResult = await this.convert(
          leftoverInTarget.toString(),
          targetCurrency,
          currency,
        );
        if (!leftoverInSrcResult) return false;

        remainingAmount = new BigNumber(leftoverInSrcResult);
      }
    }

    if (remainingAmount.isGreaterThan(0)) return false;

    clonedBalanceAccount.seqno++;
    await manager.save(BalanceAccount, clonedBalanceAccount);

    return true;
  }

  public async convert(
    amount: number | string,
    from: CurrencyEnum,
    to: CurrencyEnum,
  ): Promise<number | undefined> {
    try {
      const bnAmount = new BigNumber(amount);

      if (!bnAmount.isFinite() || bnAmount.isNegative()) {
        return undefined;
      }

      if (bnAmount.isZero()) {
        return 0;
      }

      const currencyPrice = await this.getCurrencyPrice();

      if (!currencyPrice) {
        return undefined;
      }

      if (from === to) {
        return bnAmount.dp(scale, BigNumber.ROUND_DOWN).toNumber();
      }

      let result: BigNumber | undefined;

      if (currencyPrice[from]?.[to] !== undefined) {
        const rate = new BigNumber(currencyPrice[from][to]);

        if (!rate.isFinite() || rate.isZero() || rate.isNegative()) {
          return undefined;
        }

        result = bnAmount.multipliedBy(rate);
      } else if (currencyPrice[to]?.[from] !== undefined) {
        const rate = new BigNumber(currencyPrice[to][from]);

        if (!rate.isFinite() || rate.isZero() || rate.isNegative()) {
          return undefined;
        }

        result = bnAmount.dividedBy(rate);
      } else if (from !== CurrencyEnum.USD && to !== CurrencyEnum.USD) {
        const fromUsdRate = currencyPrice[from]?.[CurrencyEnum.USD];

        const usdToRate = currencyPrice[CurrencyEnum.USD]?.[to];

        if (fromUsdRate === undefined || usdToRate === undefined) {
          return undefined;
        }

        result = bnAmount.multipliedBy(fromUsdRate).multipliedBy(usdToRate);
      }

      if (!result) {
        return undefined;
      }

      return result.dp(scale, BigNumber.ROUND_DOWN).toNumber();
    } catch (error) {
      logger.error(error);
    }
  }

  public async getTotalBalance(
    balanceAccount: BalanceAccount,
    currency: CurrencyEnum,
  ): Promise<number | undefined> {
    const currencyPrice = await this.getCurrencyPrice();
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
      if (!converted) return;
      sum += converted;
    }
    const fixedString = sum.toFixed(precision);
    const dotIndex = fixedString.indexOf('.');

    if (dotIndex === -1) return sum;

    const truncatedString = fixedString.substring(0, dotIndex + scale + 1);
    return Number(truncatedString);
  }

  public async getCurrencyPrice() {
    if (this.cache) return this.cache;

    const [cbrCurrencyBase, cryptoCurrencyBase] = await Promise.all([
      this.getCBRCurrencyBase(),
      this.getCryptoCurrencyBase(),
    ]);

    if (!cbrCurrencyBase || !cryptoCurrencyBase) return;

    BigNumber.config({ DECIMAL_PLACES: 20 });

    const usdInRub = cbrCurrencyBase.usdCurrency.rate;
    const cnyInRub = cbrCurrencyBase.cnyCurrency.rate;
    const tonInUsd = cryptoCurrencyBase.ton.usd;
    const bitcoinInUsd = cryptoCurrencyBase.bitcoin.usd;
    const ethereumInUsd = cryptoCurrencyBase.ethereum.usd;

    const priceInUsdBN: Record<string, BigNumber> = {
      usd: new BigNumber(1),
      cny: new BigNumber(cnyInRub).dividedBy(usdInRub),
      rub: new BigNumber(1).dividedBy(usdInRub),
      ton: new BigNumber(tonInUsd),
      bitcoin: new BigNumber(bitcoinInUsd),
      ethereum: new BigNumber(ethereumInUsd),
    };

    const currencies: CurrencyEnum[] = [
      CurrencyEnum.USD,
      CurrencyEnum.CNY,
      CurrencyEnum.RUB,
      CurrencyEnum.TON,
      CurrencyEnum.BITCOIN,
      CurrencyEnum.ETHEREUM,
    ];
    const cache = {} as CryptoPriceType;

    for (const from of currencies) {
      cache[from] = {} as PriceType;
      for (const to of currencies) {
        if (from === to) {
          cache[from][to] = 1;
        } else {
          cache[from][to] = priceInUsdBN[from]
            .dividedBy(priceInUsdBN[to])
            .toNumber();
        }
      }
    }

    this.cache = cache;

    setTimeout(() => {
      this.cache = null;
      this.getCurrencyPrice();
    }, this.TTL);

    return this.cache;
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
        `https://api.coingecko.com/api/v3/simple/price?ids=the-open-network,ethereum,bitcoin,usd&vs_currencies=usd,rub,cny,eur&date=${formattedDate}&localization=false`,
      ).catch(() => {});
      if (!response) return;
      const data = (await response.json()) as Partial<{
        'the-open-network': { usd: number };
        ton: { usd: number };
        bitcoin: { usd: number };
        ethereum: { usd: number };
      }>;

      data.ton = data['the-open-network'];
      delete data['the-open-network'];

      return data as {
        ton: { usd: number };
        bitcoin: { usd: number };
        ethereum: { usd: number };
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
