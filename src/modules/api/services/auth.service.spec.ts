import { DataSource, IsNull, Not, Repository } from 'typeorm';
import {
  BalanceAccount,
  scale,
} from '../../database/entities/balance-account.entity';
import { TransactionEntity } from '../../database/entities/transaction.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { AuthService } from './auth.service';
import { TransactionsService } from '../../transactions/transactions.service';
import { TelegramService } from '../../telegram/telegram-service';
import { JwtService } from '@nestjs/jwt';
import { KeyPurchaseService } from '../../key-purchase/key-purchase.service';
import { XrayService } from '../../xray/xray-service';
import { CurrencyEnum } from '../../transactions/types/currency.enum';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { dbOptions } from '../../database/database.module';

describe(`${AuthService.name} -> transfer()`, () => {
  let dataSource: DataSource;
  let pgContainer: StartedPostgreSqlContainer;
  let service: AuthService;
  const testSchema = `test_schema_${Date.now()}`;
  let balanceAccounts: BalanceAccount[] = [];
  const setAmount = 10000;
  const userCount = 1000;

  let balanceAccountRepository: Repository<BalanceAccount>;

  beforeAll(async () => {
    pgContainer = await new PostgreSqlContainer('postgres:17-alpine')
      .withCommand([
        'postgres',
        '-c',
        'fsync=off',
        '-c',
        'synchronous_commit=off',
        '-c',
        'full_page_writes=off',
      ])
      .start();

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
    balanceAccountRepository = dataSource.getRepository(BalanceAccount);
    const transactionsService = new TransactionsService({} as TelegramService);
    service = new AuthService(
      dataSource,
      {} as JwtService,
      {} as KeyPurchaseService,
      {} as XrayService,
      transactionsService,
    );

    const arr = Array.from({ length: userCount }, () => ({
      id: crypto.randomUUID().replace(/-/g, ''),
      languageCode: 'ru',
    }));

    const balanceAccountsArray = arr.map((user) => ({
      userId: user.id,
      cny: setAmount,
      rub: setAmount,
      usd: setAmount,
      ton: setAmount,
      ethereum: setAmount,
      bitcoin: setAmount,
    }));

    await dataSource.manager.save(UserEntity, arr);
    balanceAccounts = await dataSource.manager.save(
      BalanceAccount,
      balanceAccountsArray,
    );
  });

  afterEach(async () => {
    const [usdSum, tonSum, rubSum, cnySum] = await Promise.all([
      balanceAccountRepository.sum('usd'),
      balanceAccountRepository.sum('ton'),
      balanceAccountRepository.sum('rub'),
      balanceAccountRepository.sum('cny'),
    ]);

    expect(usdSum).toEqual(setAmount * userCount);
    expect(tonSum).toEqual(setAmount * userCount);
    expect(rubSum).toEqual(setAmount * userCount);
    expect(cnySum).toEqual(setAmount * userCount);

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

  it('base test: DataSource should be initialized', () => {
    expect(dataSource.isInitialized).toBe(true);
  });

  it('should rollback transaction if error occurs in the middle', async () => {
    const amount = 1;
    const currency = CurrencyEnum.RUB;
    const transactionsService = new TransactionsService({} as TelegramService);

    const transactionsCountBefore = await dataSource.manager.count(
      TransactionEntity,
      {},
    );

    jest
      .spyOn(transactionsService, 'addBalance')
      .mockRejectedValue(new Error('Test error'));

    service = new AuthService(
      dataSource,
      {} as JwtService,
      {} as KeyPurchaseService,
      {} as XrayService,
      transactionsService,
    );

    const result = await service.transfer({
      userId: balanceAccounts[0].userId,
      amount,
      currency,
      recipient: balanceAccounts[1].userId,
      seqno: 1,
    });

    const balanceAccount = await balanceAccountRepository.findOneByOrFail({
      userId: balanceAccounts[0].userId,
    });

    const transactionsCountAfter = await dataSource.manager.count(
      TransactionEntity,
      {},
    );

    expect(result).toBeUndefined();
    expect(balanceAccounts[0][currency]).toBe(balanceAccount[currency]);
    expect(transactionsCountBefore).toBe(transactionsCountAfter);
  });

  it('should successfully transfer money between accounts', async () => {
    const amount = 1;
    const currency = CurrencyEnum.RUB;

    await service.transfer({
      userId: balanceAccounts[0].userId,
      amount,
      currency,
      recipient: balanceAccounts[1].userId,
      seqno: 1,
    });

    const [user1, user2] = await Promise.all([
      balanceAccountRepository.findOneOrFail({
        where: { userId: balanceAccounts[0].userId },
      }),
      balanceAccountRepository.findOneOrFail({
        where: { userId: balanceAccounts[1].userId },
      }),
    ]);

    expect(user1.rub).toBe(balanceAccounts[0].rub - amount);
    expect(user2.rub).toBe(balanceAccounts[1].rub + amount);
  });

  it('should fail if incorrect seqno', async () => {
    const amount = 100;
    const currency = CurrencyEnum.RUB;

    const transactionsCountBefore = await dataSource.manager.count(
      TransactionEntity,
      {},
    );

    await service.transfer({
      userId: balanceAccounts[0].userId,
      amount,
      currency,
      recipient: balanceAccounts[1].userId,
      seqno: 2,
    });

    const transactionsCountAfter = await dataSource.manager.count(
      TransactionEntity,
      {},
    );
    const balanceAccount = await balanceAccountRepository.findOneByOrFail({
      userId: balanceAccounts[0].userId,
    });

    expect(transactionsCountBefore).toBe(transactionsCountAfter);
    expect(balanceAccount[currency]).toBe(balanceAccount[currency]);
  });

  it(`should handle concurrent transfers between same users without deadlocks`, async () => {
    const amount = 100;
    const currency = CurrencyEnum.RUB;

    await Promise.all([
      service.transfer({
        userId: balanceAccounts[0].userId,
        amount,
        currency,
        recipient: balanceAccounts[1].userId,
        seqno: 1,
      }),
      service.transfer({
        userId: balanceAccounts[1].userId,
        amount: amount * 2,
        currency,
        recipient: balanceAccounts[0].userId,
        seqno: 1,
      }),
    ]);

    const [account1, account2] = await Promise.all([
      balanceAccountRepository.findOneByOrFail({
        userId: balanceAccounts[0].userId,
      }),
      balanceAccountRepository.findOneByOrFail({
        userId: balanceAccounts[1].userId,
      }),
    ]);

    expect(account1[currency]).toBe(balanceAccounts[0][currency] + amount);
    expect(account2[currency]).toBe(balanceAccounts[1][currency] - amount);
  });

  it(`should not transfer double spend (correct seqno) if not enough money`, async () => {
    const amount = setAmount / 2 + 1;
    const currency = CurrencyEnum.RUB;

    expect(setAmount).toBeLessThanOrEqual(amount * 2);

    const operationPayload = {
      userId: balanceAccounts[0].userId,
      amount,
      currency,
      recipient: balanceAccounts[1].userId,
    };

    const promises: Promise<unknown>[] = [];

    promises.push(service.transfer({ ...operationPayload, seqno: 1 }));
    await new Promise((resolve) => setTimeout(resolve, 1));
    promises.push(service.transfer({ ...operationPayload, seqno: 2 }));

    await Promise.all(promises);

    const balanceAccount = await balanceAccountRepository.findOneOrFail({
      where: { userId: balanceAccounts[0].userId },
    });

    expect(balanceAccount[currency]).toBeLessThanOrEqual(setAmount - amount);
  });

  it(`should not transfer double spend (same seqno)`, async () => {
    const amount = 10;
    const currency = CurrencyEnum.RUB;

    const operationPayload = {
      userId: balanceAccounts[0].userId,
      amount,
      currency,
      recipient: balanceAccounts[1].userId,
      seqno: 1,
    };

    await Promise.all([
      service.transfer(operationPayload),
      service.transfer(operationPayload),
    ]);

    const balanceAccount = await balanceAccountRepository.findOneOrFail({
      where: { userId: balanceAccounts[0].userId },
    });

    expect(balanceAccount[currency]).toBeLessThanOrEqual(setAmount - amount);
  });

  it('should not transfer if insufficient funds', async () => {
    const amount = setAmount + 1;
    const currency = CurrencyEnum.RUB;

    const payload = {
      userId: balanceAccounts[0].userId,
      recipient: balanceAccounts[1].userId,
      amount,
      currency,
      seqno: 1,
    };
    const result = await service.transfer(payload);

    expect(result).toBeUndefined();
  });

  it('should not transfer if amount no more than 0', async () => {
    const amount = -1;
    const currency = CurrencyEnum.RUB;

    const payload = {
      userId: balanceAccounts[0].userId,
      recipient: balanceAccounts[1].userId,
      amount,
      currency,
      seqno: 1,
    };
    const result = await service.transfer(payload);

    expect(result).toBeUndefined();
  });

  it('should not transfer if amount 0', async () => {
    const amount = 0;
    const currency = CurrencyEnum.RUB;

    const payload = {
      userId: balanceAccounts[0].userId,
      recipient: balanceAccounts[1].userId,
      amount,
      currency,
      seqno: 1,
    };
    const result = await service.transfer(payload);

    expect(result).toBeUndefined();
  });

  it(`should not transfer if scale >  ${scale}`, async () => {
    const amount = 10 ** (-scale - 1);
    const currency = CurrencyEnum.RUB;

    const result1 = await service.transfer({
      userId: balanceAccounts[0].userId,
      recipient: balanceAccounts[1].userId,
      amount,
      currency,
      seqno: 1,
    });

    const result2 = await service.transfer({
      userId: balanceAccounts[0].userId,
      recipient: balanceAccounts[1].userId,
      amount: 10 + amount,
      currency,
      seqno: 1,
    });

    expect(result1).toBeUndefined();
    expect(result2).toBeUndefined();
  });

  it('should not transfer if yourself', async () => {
    const amount = 1;
    const currency = CurrencyEnum.RUB;

    const payload = {
      userId: balanceAccounts[0].userId,
      recipient: balanceAccounts[0].userId,
      amount,
      currency,
      seqno: 1,
    };
    const result = await service.transfer(payload);

    expect(result).toBeUndefined();
  });

  it(`should be fast: parallel TPS more than 400 `, async () => {
    const start = Date.now();
    const amount = 1;
    const currency = CurrencyEnum.RUB;

    const promises = balanceAccounts.map((account, index) =>
      service.transfer({
        userId: account.userId,
        currency,
        amount,
        recipient: balanceAccounts[(index + 1) % userCount].userId,
        seqno: 1,
      }),
    );

    await Promise.all(promises);
    const end = Date.now();

    const count = await dataSource.manager.count(TransactionEntity);
    const TPS = balanceAccounts.length / ((end - start) / 1000);

    // 400 for local, 50 for CI
    const requiredTPS = process.env.CI === 'true' ? 50 : 400;
    expect(TPS).not.toBeLessThan(requiredTPS);
    expect(count).toBe(balanceAccounts.length * 2);
  });
});
