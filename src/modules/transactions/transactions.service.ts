import { Injectable } from '@nestjs/common';
import { EntityManager, IsNull, Not, LessThanOrEqual } from 'typeorm';
import { TransactionEntity } from '../database/entities/transaction.entity';
import { ExchangeEntity } from '../database/entities/exchange.entity';
import { UserEntity } from '../database/entities/user.entity';

@Injectable()
export class TransactionsService {
  constructor(private readonly em: EntityManager) {}

  public async scanExchange() {
    const date = new Date();
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Месяцы 0-11
    const year = date.getFullYear();
    const formattedDate = `${day}-${month}-${year}`;

    const tonPrice = await this.getTonPrice(formattedDate);
    const usdPrice = await this.getUsdTPrice(formattedDate);

    if (tonPrice)
      await this.em.insert(ExchangeEntity, [
        {
          date: date.getTime(),
          currency: 'TON',
          priceCurrency: 'РУБ',
          price: tonPrice.rub,
        },
        {
          date: date.getTime(),
          currency: 'TON',
          priceCurrency: 'USD',
          price: tonPrice.usd,
        },
        {
          date: date.getTime(),
          currency: 'TON',
          priceCurrency: 'CNY',
          price: tonPrice.cny,
        },
      ]);

    if (usdPrice)
      await this.em.insert(ExchangeEntity, [
        {
          date: date.getTime(),
          currency: 'USDT',
          priceCurrency: 'РУБ',
          price: usdPrice.rub,
        },
        {
          date: date.getTime(),
          currency: 'USDT',
          priceCurrency: 'CNY',
          price: usdPrice.cny,
        },
      ]);
  }

  public async scanUserTransactions() {
    const transactions = await this.em.find(TransactionEntity, {
      where: { userId: Not(IsNull()), completed: false, type: 'Credit' },
    });
    if (!transactions.length) return;

    await Promise.all(
      transactions.map(async (transaction) => {
        const [exchange] = await this.em.find(ExchangeEntity, {
          where: {
            priceCurrency: 'РУБ',
            currency: transaction.currency,
            date: LessThanOrEqual(transaction.createdAt),
          },
          order: { date: 'DESC' },
        });
        if (!exchange) return;

        const addBalance = transaction.amount * exchange.price;

        await this.em
          .createQueryBuilder()
          .update(UserEntity)
          .set({
            balance: () => `balance + ${addBalance}`,
          })
          .where('id = :id', { id: transaction.userId })
          .execute();

        await this.em.update(
          TransactionEntity,
          { id: transaction.id },
          { completed: true },
        );
      }),
    );
  }

  private async getTonPrice(date: string) {
    try {
      const response = await fetch(
        `https://api.coingecko.com/api/v3/coins/the-open-network/history?date=${date}&localization=false`,
      ).catch(() => {});
      if (!response) return;

      const payload = (await response.json()) as TonPriceType;
      return payload.market_data?.current_price;
    } catch (error) {
      console.log(error);
    }
  }

  private async getUsdTPrice(date: string) {
    try {
      const response = await fetch(
        `https://api.coingecko.com/api/v3/coins/tether/history?date=${date}&localization=false`,
      ).catch(() => {});
      if (!response) return;

      const payload = (await response.json()) as TonPriceType;
      return payload?.market_data?.current_price;
    } catch (error) {
      console.log(error);
    }
  }
}

type TonPriceType = {
  market_data: {
    current_price: {
      rub: number;
      usd: number;
      cny: number;
    };
  };
};
