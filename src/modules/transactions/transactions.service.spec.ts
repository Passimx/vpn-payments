import { TransactionsService } from './transactions.service';
import { CurrencyEnum } from './types/currency.enum';
import { TelegramService } from '../telegram/telegram-service';
import {
  BalanceAccount,
  scale,
} from '../database/entities/balance-account.entity';
import { DataSource, IsNull, Not } from 'typeorm';
import { dbOptions } from '../database/database.module';
import { UserEntity } from '../database/entities/user.entity';
import { TransactionEntity } from '../database/entities/transaction.entity';
import { CryptoPriceType } from './types/crypto-price.type';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

const mockCurrencyPrice: CryptoPriceType = {
  usd: {
    usd: 1,
    cny: 6.722480072250363,
    rub: 85.6007,
    ton: 0.7299270072992701,
    bitcoin: 0.00001270793356292333,
    ethereum: 0.000403996331713308,
  },
  cny: {
    usd: 0.14875462467012537,
    cny: 1,
    rub: 12.7335,
    ton: 0.10858001800739077,
    bitcoin: 0.00000189036388748555,
    ethereum: 0.0000600963226921206,
  },
  rub: {
    usd: 0.011682147459074517,
    cny: 0.07853300349471866,
    rub: 1,
    ton: 0.008527114933631034,
    bitcoin: 1.4845595378219e-7,
    ethereum: 0.00000471954472000005,
  },
  ton: {
    usd: 1.37,
    cny: 9.209797698982998,
    rub: 117.272959,
    ton: 1,
    bitcoin: 0.00001740986898120497,
    ethereum: 0.000553474974447232,
  },
  bitcoin: {
    usd: 78691,
    cny: 528998.6793654533,
    rub: 6736004.6837,
    ton: 57438.686131386865,
    bitcoin: 1,
    ethereum: 31.790875338851922,
  },
  ethereum: {
    usd: 2475.27,
    cny: 16639.953248439157,
    rub: 211884.844689,
    ton: 1806.7664233576643,
    bitcoin: 0.03145556671029724,
    ethereum: 1,
  },
};

describe(`${TransactionsService.name} -> convert()`, () => {
  let service: TransactionsService;

  beforeEach(() => {
    const mockTelegramService = {} as TelegramService;

    service = new TransactionsService(mockTelegramService);

    jest
      .spyOn(service, 'getCurrencyPrice')
      .mockResolvedValue(structuredClone(mockCurrencyPrice));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return the original amount when from and to currencies are identical', async () => {
    const amount = 100;
    const result = await service.convert(
      amount,
      CurrencyEnum.USD,
      CurrencyEnum.USD,
    );
    expect(result).toBe(100);
  });

  it('should properly convert using direct rate (USD to RUB) and match precision scale', async () => {
    const result = await service.convert(
      100,
      CurrencyEnum.USD,
      CurrencyEnum.RUB,
    );

    expect(result).toBeCloseTo(8560.07, 8);
  });

  it('should convert using reverse rate (RUB to USD) and strictly truncate decimals downward', async () => {
    const currencyPrice = await service.getCurrencyPrice();

    if (currencyPrice && currencyPrice[CurrencyEnum.RUB]) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      delete (currencyPrice[CurrencyEnum.RUB] as any)[CurrencyEnum.USD];
    }

    const result = await service.convert(
      1000,
      CurrencyEnum.RUB,
      CurrencyEnum.USD,
    );

    expect(result).toBe(11.68214745);
  });

  it('should handle cross-currency conversion through USD and apply truncation at the final step', async () => {
    const result = await service.convert(
      500,
      CurrencyEnum.CNY,
      CurrencyEnum.TON,
    );
    expect(result).toBeDefined();
    expect(result).toBeLessThanOrEqual(54.290009);
  });

  it('should guarantee that the converted amount is never rounded up to protect system balance', async () => {
    const result = await service.convert(
      1,
      CurrencyEnum.RUB,
      CurrencyEnum.BITCOIN,
    );
    const stringResult = result?.toString() || '';
    const decimalPart = stringResult.split('.')[1] || '';
    expect(decimalPart.length).toBeLessThanOrEqual(8);
  });

  it('should return undefined when input amount is NaN or negative', async () => {
    const resultNaN = await service.convert(
      NaN,
      CurrencyEnum.USD,
      CurrencyEnum.RUB,
    );
    expect(resultNaN).toBeUndefined();

    const resultNegative = await service.convert(
      -50,
      CurrencyEnum.USD,
      CurrencyEnum.RUB,
    );
    expect(resultNegative).toBeUndefined();
  });

  // round = 0.1 ** scale
  it('should maintain the exact same balance after 1000 iterations of round-trip conversion', async () => {
    const initialAmount = 1024.10112832;
    let currentAmount = initialAmount;
    const okayLess = 0.1 ** scale;

    for (let i = 0; i < 1000; i++) {
      const inRub = await service.convert(
        currentAmount,
        CurrencyEnum.USD,
        CurrencyEnum.RUB,
      );
      expect(inRub).toBeDefined();

      const backToUsd = await service.convert(
        inRub,
        CurrencyEnum.RUB,
        CurrencyEnum.USD,
      );
      expect(backToUsd).toBeDefined();

      currentAmount = backToUsd!;
    }

    expect(currentAmount).not.toBeLessThan(initialAmount - okayLess * 1000);
    expect(currentAmount).toBeLessThanOrEqual(initialAmount);
  });

  it('should maintain a valid balance after 1000 iterations of round-trip conversion without phantom inflation', async () => {
    const initialAmount = 1024.10112832;
    let currentAmount = initialAmount;

    const oneSatoshi = 10 ** -scale; // 0.00000001

    for (let i = 0; i < 1000; i++) {
      const inRub = await service.convert(
        currentAmount,
        CurrencyEnum.USD,
        CurrencyEnum.RUB,
      );
      expect(inRub).toBeDefined();

      const backToUsd = await service.convert(
        inRub,
        CurrencyEnum.RUB,
        CurrencyEnum.USD,
      );
      expect(backToUsd).toBeDefined();

      currentAmount = backToUsd!;
    }

    expect(currentAmount).toBeLessThanOrEqual(initialAmount);
    expect(currentAmount).toBeGreaterThan(initialAmount - oneSatoshi * 1050);
  });

  it('should return the exact same amount when source and target currencies are identical', async () => {
    const result = await service.convert(
      123.456,
      CurrencyEnum.USD,
      CurrencyEnum.USD,
    );
    expect(result).toBe(123.456);
  });

  it('should successfully handle amount passed as a string', async () => {
    const result = await service.convert(
      '100',
      CurrencyEnum.USD,
      CurrencyEnum.RUB,
    );
    expect(result).toBe(8560.07);
  });

  it('should return undefined if amount is negative', async () => {
    const result = await service.convert(
      -50.5,
      CurrencyEnum.USD,
      CurrencyEnum.RUB,
    );
    expect(result).toBeUndefined();
  });

  it('should return 0 if amount is exactly zero', async () => {
    const result = await service.convert(0, CurrencyEnum.USD, CurrencyEnum.RUB);
    expect(result).toBe(0);
  });

  it('should return undefined if string amount cannot be parsed into a number (NaN)', async () => {
    const result = await service.convert(
      'invalid_number',
      CurrencyEnum.USD,
      CurrencyEnum.RUB,
    );
    expect(result).toBeUndefined();
  });

  it('should return undefined if getCurrencyPrice returns falsy value', async () => {
    jest.spyOn(service, 'getCurrencyPrice').mockResolvedValueOnce(undefined);
    const result = await service.convert(
      100,
      CurrencyEnum.USD,
      CurrencyEnum.RUB,
    );
    expect(result).toBeUndefined();
  });

  it('should convert fiat to fiat using direct multiplication', async () => {
    // 250 USD * 85.6007 (usd.rub) = 21400.175
    const result = await service.convert(
      250,
      CurrencyEnum.USD,
      CurrencyEnum.RUB,
    );
    expect(result).toBe(21400.175);
  });

  it('should convert large fiat amounts to crypto with high scale precision', async () => {
    // 500000 USD * 0.00001270793356292333 (usd.bitcoin) = 6.35396678146
    // ROUND_DOWN to 8 decimals -> 6.35396678
    const result = await service.convert(
      500000,
      CurrencyEnum.USD,
      CurrencyEnum.BITCOIN,
    );
    expect(result).toBe(6.35396678);
  });

  it('should convert bitcoin to fiat and cut off trailing micro-decimals', async () => {
    // 0.5 BTC * 6736004.6837 (bitcoin.rub) = 3368002.34185
    // ROUND_DOWN to 8 decimals -> 3368002.34185
    const result = await service.convert(
      0.5,
      CurrencyEnum.BITCOIN,
      CurrencyEnum.RUB,
    );
    expect(result).toBe(3368002.34185);
  });

  it('should trigger division when only the reverse currency key is present', async () => {
    const prices = await service.getCurrencyPrice();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    delete (prices!.cny as any).usd;

    // 1000 CNY / 6.722480072250363 (usd.cny) = 148.7546246701...
    // ROUND_DOWN to 8 decimals -> 148.75462467
    const result = await service.convert(
      1000,
      CurrencyEnum.CNY,
      CurrencyEnum.USD,
    );
    expect(result).toBe(148.75462467);
  });

  it('should correctly divide and truncate periodic decimals downwards', async () => {
    const prices = await service.getCurrencyPrice();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    delete (prices!.rub as any).usd;

    const result = await service.convert(
      1000,
      CurrencyEnum.RUB,
      CurrencyEnum.USD,
    );
    expect(result).toBe(11.68214745);
  });

  it('should execute cross-conversion when neither currency is USD', async () => {
    const prices = await service.getCurrencyPrice();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    delete (prices!.rub as any).cny;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    delete (prices!.cny as any).rub;

    const result = await service.convert(
      10000,
      CurrencyEnum.RUB,
      CurrencyEnum.CNY,
    );
    expect(result).toBe(785.33003494);
  });

  it('should correctly handle multi-step crypto-to-crypto cross-conversion via USD', async () => {
    const prices = await service.getCurrencyPrice();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    delete (prices!.bitcoin as any).ethereum;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    delete (prices!.ethereum as any).bitcoin;

    const result = await service.convert(
      0.1,
      CurrencyEnum.BITCOIN,
      CurrencyEnum.ETHEREUM,
    );
    expect(result).toBe(3.17908753);
  });

  it('should maintain a valid balance after 1000 iterations of round-trip conversion without phantom inflation', async () => {
    const initialAmount = 1024.10112832;
    let currentAmount = initialAmount;
    const oneSatoshi = 0.00000001;

    for (let i = 0; i < 1000; i++) {
      const inRub = await service.convert(
        currentAmount,
        CurrencyEnum.USD,
        CurrencyEnum.RUB,
      );
      expect(inRub).toBeDefined();

      const backToUsd = await service.convert(
        inRub,
        CurrencyEnum.RUB,
        CurrencyEnum.USD,
      );
      expect(backToUsd).toBeDefined();

      currentAmount = backToUsd!;
    }

    expect(currentAmount).toBeLessThanOrEqual(initialAmount);

    expect(currentAmount).toBe(1024.10111832);
    expect(currentAmount).toBeGreaterThan(initialAmount - oneSatoshi * 1050);
  });

  it('should never round up even if the 9th decimal digit is a nine', async () => {
    const prices = await service.getCurrencyPrice();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    (prices as any).usd.rub = 1.000000000099;

    const result = await service.convert(
      100,
      CurrencyEnum.USD,
      CurrencyEnum.RUB,
    );

    expect(result).toBe(100);
  });
});

describe(`${TransactionsService.name} -> decreaseBalanceFromAll()`, () => {
  let dataSource: DataSource;
  let pgContainer: StartedPostgreSqlContainer;
  const testSchema = `test_schema_${Date.now()}`;
  const setAmount = 10000;
  let user: UserEntity;
  let balanceAccount: BalanceAccount;
  let service: TransactionsService;

  beforeAll(async () => {
    pgContainer = await new PostgreSqlContainer('postgres:17-alpine').start();

    const containerOptions = {
      ...dbOptions,
      host: pgContainer.getHost(),
      port: pgContainer.getPort(),
      database: pgContainer.getDatabase(),
      username: pgContainer.getUsername(),
      password: pgContainer.getPassword(),
    };

    const initClient = new DataSource(containerOptions);
    await initClient.initialize();
    await initClient.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema};`);
    await initClient.destroy();

    dataSource = new DataSource({
      ...containerOptions,
      schema: testSchema,
      synchronize: true,
    });

    await dataSource.initialize();
  }, 60 * 1000);

  beforeEach(async () => {
    user = await dataSource.manager.save(UserEntity, {
      id: crypto.randomUUID().replace(/-/g, ''),
      languageCode: 'ru',
    });

    balanceAccount = await dataSource.manager.save(BalanceAccount, {
      userId: user.id,
      cny: setAmount,
      rub: setAmount,
      usd: setAmount,
      ton: setAmount,
      ethereum: setAmount,
      bitcoin: setAmount,
    });

    const mockTelegramService = {} as TelegramService;

    service = new TransactionsService(mockTelegramService);

    jest
      .spyOn(service, 'getCurrencyPrice')
      .mockResolvedValue(structuredClone(mockCurrencyPrice));
  });

  afterEach(async () => {
    await dataSource.manager.delete(BalanceAccount, { userId: Not(IsNull()) });
    await dataSource.manager.delete(UserEntity, { id: Not(IsNull()) });
    await dataSource.manager.delete(TransactionEntity, { id: Not(IsNull()) });
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }

    if (pgContainer) {
      await pgContainer.stop();
    }
  });

  it('should deduct the amount from multiple currencies', async () => {
    balanceAccount.rub = 100;
    balanceAccount.cny = 0;
    balanceAccount.usd = 100;
    balanceAccount.seqno = 1;

    await dataSource.manager.save(BalanceAccount, balanceAccount);

    jest.spyOn(service, 'getCurrencyPrice').mockResolvedValue({
      test: true,
    } as any);

    jest.spyOn(service, 'convert').mockImplementation(
      (amount, from, to) =>
        new Promise((resolve) => {
          if (from === CurrencyEnum.RUB && to === CurrencyEnum.RUB) {
            resolve(Number(amount));
          }

          // 1 USD = 50 RUB
          if (from === CurrencyEnum.RUB && to === CurrencyEnum.USD) {
            resolve(Number(amount) / 50);
          }

          if (from === CurrencyEnum.USD && to === CurrencyEnum.RUB) {
            resolve(Number(amount) * 50);
          }

          resolve(undefined);
        }),
    );

    const result = await service.decreaseBalanceFromAll(
      balanceAccount,
      150,
      CurrencyEnum.RUB,
      dataSource.manager,
    );

    const account = await dataSource.manager.findOneByOrFail(BalanceAccount, {
      userId: user.id,
    });

    expect(result).toBe(true);
    expect(account.rub).toBe(0);
    expect(account.usd).toBe(99);
    expect(account.seqno).toBe(2);
  });

  it('should deduct the amount from a single currency', async () => {
    balanceAccount.rub = 1000;
    balanceAccount.usd = 100;
    balanceAccount.seqno = 1;

    await dataSource.manager.save(BalanceAccount, balanceAccount);

    jest.spyOn(service, 'getCurrencyPrice').mockResolvedValue({
      // любое валидное значение, если метод просто проверяет наличие объекта
    } as any);

    jest.spyOn(service, 'convert').mockImplementation(
      (amount, from, to) =>
        new Promise((resolve) => {
          if (from === CurrencyEnum.RUB && to === CurrencyEnum.RUB) {
            resolve(Number(amount));
          }

          resolve(undefined);
        }),
    );

    const result = await service.decreaseBalanceFromAll(
      balanceAccount,
      500,
      CurrencyEnum.RUB,
      dataSource.manager,
    );

    const account = await dataSource.manager.findOneByOrFail(BalanceAccount, {
      userId: user.id,
    });

    expect(result).toBe(true);
    expect(account.rub).toBe(500);
    expect(account.usd).toBe(100);
    expect(account.seqno).toBe(2);
  });

  it('should return false if failed to convert the amount to the target currency', async () => {
    balanceAccount.rub = 1000;

    jest.spyOn(service, 'getCurrencyPrice').mockResolvedValue({
      test: true,
    } as any);

    jest.spyOn(service, 'convert').mockResolvedValue(undefined);

    const result = await service.decreaseBalanceFromAll(
      balanceAccount,
      100,
      CurrencyEnum.RUB,
      dataSource.manager,
    );

    expect(result).toBe(false);
  });

  it('should return false if failed to fetch currency exchange rates', async () => {
    jest.spyOn(service, 'getCurrencyPrice').mockResolvedValue(undefined);

    const result = await service.decreaseBalanceFromAll(
      balanceAccount,
      100,
      CurrencyEnum.RUB,
      dataSource.manager,
    );

    expect(result).toBe(false);
  });

  it('should return false if the total balance is insufficient', async () => {
    balanceAccount.rub = 100;
    balanceAccount.cny = 0;
    balanceAccount.usd = 1;
    balanceAccount.ton = 0;
    balanceAccount.ethereum = 0;
    balanceAccount.bitcoin = 0;
    balanceAccount.seqno = 1;

    jest.spyOn(service, 'getCurrencyPrice').mockResolvedValue({
      test: true,
    } as any);

    jest.spyOn(service, 'convert').mockImplementation(
      (amount, from, to) =>
        new Promise((resolve) => {
          if (from === to) {
            resolve(Number(amount));
          }

          // 1 USD = 50 RUB
          if (from === CurrencyEnum.RUB && to === CurrencyEnum.USD) {
            resolve(Number(amount) / 50);
          }

          if (from === CurrencyEnum.USD && to === CurrencyEnum.RUB) {
            resolve(Number(amount) * 50);
          }

          resolve(undefined);
        }),
    );

    const result = await service.decreaseBalanceFromAll(
      balanceAccount,
      200,
      CurrencyEnum.RUB,
      dataSource.manager,
    );

    expect(result).toBe(false);
    expect(balanceAccount.seqno).toBe(1);
  });

  it('should not change the balance if total funds are insufficient', async () => {
    balanceAccount.rub = 100;
    balanceAccount.usd = 1;
    balanceAccount.seqno = 1;

    jest.spyOn(service, 'getCurrencyPrice').mockResolvedValue({
      test: true,
    } as any);

    jest.spyOn(service, 'convert').mockImplementation(
      (amount, from, to) =>
        new Promise((resolve) => {
          if (from === to) {
            resolve(Number(amount));
          }

          if (from === CurrencyEnum.RUB && to === CurrencyEnum.USD) {
            resolve(Number(amount) / 50);
          }

          if (from === CurrencyEnum.USD && to === CurrencyEnum.RUB) {
            resolve(Number(amount) * 50);
          }

          resolve(undefined);
        }),
    );

    const result = await service.decreaseBalanceFromAll(
      balanceAccount,
      200,
      CurrencyEnum.RUB,
      dataSource.manager,
    );

    expect(result).toBe(false);

    expect(balanceAccount.rub).toBe(100);
    expect(balanceAccount.usd).toBe(1);
    expect(balanceAccount.seqno).toBe(1);
  });

  it('should return false if failed to convert the remainder back to the original currency', async () => {
    balanceAccount.rub = 50;
    balanceAccount.usd = 100;

    jest.spyOn(service, 'getCurrencyPrice').mockResolvedValue({
      test: true,
    } as any);

    jest.spyOn(service, 'convert').mockImplementation(
      (amount, from, to) =>
        new Promise((resolve) => {
          // Нужно списать 100 RUB, но RUB только 50
          if (from === CurrencyEnum.RUB && to === CurrencyEnum.RUB) {
            resolve(Number(amount));
          }

          // 100 RUB -> 2 USD
          if (from === CurrencyEnum.RUB && to === CurrencyEnum.USD) {
            resolve(Number(amount) / 50);
          }

          // Ошибка при USD -> RUB
          if (from === CurrencyEnum.USD && to === CurrencyEnum.RUB) {
            resolve(undefined);
          }

          resolve(undefined);
        }),
    );

    const result = await service.decreaseBalanceFromAll(
      balanceAccount,
      100,
      CurrencyEnum.RUB,
      dataSource.manager,
    );

    expect(result).toBe(false);
  });
});

describe(`${TransactionsService.name} -> getTotalBalance()`, () => {
  let service: TransactionsService;

  beforeEach(() => {
    const mockTelegramService = {} as TelegramService;

    service = new TransactionsService(mockTelegramService);

    jest
      .spyOn(service, 'getCurrencyPrice')
      .mockResolvedValue(structuredClone(mockCurrencyPrice));
  });

  it('should return the total balance converted to the requested currency', async () => {
    const balanceAccount = {
      rub: 100,
      usd: 10,
      cny: 0,
      ton: 0,
      ethereum: 0,
      bitcoin: 0,
    } as BalanceAccount;

    jest.spyOn(service, 'getCurrencyPrice').mockResolvedValue({} as any);

    jest.spyOn(service, 'convert').mockImplementation(
      (amount, from, to) =>
        new Promise((resolve) => {
          if (to !== CurrencyEnum.RUB) resolve(undefined);

          if (from === CurrencyEnum.RUB) {
            resolve(Number(amount));
          }

          if (from === CurrencyEnum.USD) {
            resolve(Number(amount) * 100);
          }

          resolve(0);
        }),
    );

    const result = await service.getTotalBalance(
      balanceAccount,
      CurrencyEnum.RUB,
    );

    expect(result).toBe(1100);
  });

  it('should ignore zero balances and non-currency fields', async () => {
    const balanceAccount = {
      rub: 100,
      usd: 0,
      cny: 0,
      ton: 0,
      ethereum: 0,
      bitcoin: 0,
      seqno: 123,
    } as BalanceAccount;

    jest.spyOn(service, 'getCurrencyPrice').mockResolvedValue({} as any);

    const convertSpy = jest
      .spyOn(service, 'convert')
      .mockImplementation(
        async (amount) => new Promise((resolve) => resolve(Number(amount))),
      );

    const result = await service.getTotalBalance(
      balanceAccount,
      CurrencyEnum.RUB,
    );

    expect(result).toBe(100);

    expect(convertSpy).toHaveBeenCalledTimes(1);

    expect(convertSpy).toHaveBeenCalledWith(
      100,
      CurrencyEnum.RUB,
      CurrencyEnum.RUB,
    );
  });

  it('should return undefined when currency prices are unavailable', async () => {
    const balanceAccount = {
      rub: 100,
      usd: 10,
      cny: 0,
      ton: 0,
      ethereum: 0,
      bitcoin: 0,
      seqno: 1,
    } as BalanceAccount;

    jest.spyOn(service, 'getCurrencyPrice').mockResolvedValue(undefined);

    const convertSpy = jest.spyOn(service, 'convert');

    const result = await service.getTotalBalance(
      balanceAccount,
      CurrencyEnum.RUB,
    );

    expect(result).toBeUndefined();
    expect(convertSpy).not.toHaveBeenCalled();
  });

  it('should return undefined when currency conversion fails', async () => {
    const balanceAccount = {
      rub: 100,
      usd: 10,
      cny: 0,
      ton: 0,
      ethereum: 0,
      bitcoin: 0,
      seqno: 1,
    } as BalanceAccount;

    jest.spyOn(service, 'getCurrencyPrice').mockResolvedValue({} as any);

    jest.spyOn(service, 'convert').mockImplementation(
      (amount, from) =>
        new Promise((resolve) => {
          if (from === CurrencyEnum.RUB) {
            resolve(Number(amount));
          }

          resolve(undefined);
        }),
    );

    const result = await service.getTotalBalance(
      balanceAccount,
      CurrencyEnum.RUB,
    );

    expect(result).toBeUndefined();
  });

  it('should truncate the total balance to the configured decimal scale', async () => {
    const balanceAccount = {
      rub: 1,
      usd: 1,
      cny: 0,
      ton: 0,
      ethereum: 0,
      bitcoin: 0,
      seqno: 1,
    } as BalanceAccount;

    jest.spyOn(service, 'getCurrencyPrice').mockResolvedValue({} as any);

    jest.spyOn(service, 'convert').mockImplementation(
      (amount, from) =>
        new Promise((resolve) => {
          if (from === CurrencyEnum.RUB) {
            resolve(1.123456789);
          }

          if (from === CurrencyEnum.USD) {
            resolve(2.987654321);
          }

          resolve(undefined);
        }),
    );

    const result = await service.getTotalBalance(
      balanceAccount,
      CurrencyEnum.RUB,
    );

    expect(result).toBe(4.1111111);
  });
});
