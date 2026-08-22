import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Not } from 'typeorm';
import { UserEntity } from '../../database/entities/user.entity';
import { DataResponse } from '../dto/responses/data-response.dto';
import { JwtService } from '@nestjs/jwt';
import { TokenType } from '../types/token.type';
import { UserResponseDto } from '../dto/responses/user.dto';
import { ExtendKeyDto } from '../dto/requests/extend-key.dto';
import { KeyPurchaseService } from '../../key-purchase/key-purchase.service';
import { ServerEntity } from '../../database/entities/server.entity';
import { GetServerDto } from '../dto/responses/get-server.dto';
import { XrayService } from '../../xray/xray-service';
import { UserKeyEntity } from '../../database/entities/user-key.entity';
import { KeyIdDto } from '../dto/requests/key-id.dto';
import { RefInfoDto, RefInfoUserItemDto } from '../dto/responses/ref-info.dto';
import { BalanceAccount } from '../../database/entities/balance-account.entity';
import { CreateAccountDto } from '../dto/requests/create-account.dto';
import { StringsUtil } from '../../../common/utils/strings.util';
import { ExchangeBalanceDto } from '../dto/requests/exchange-balance.dto';
import { TransactionsService } from '../../transactions/transactions.service';
import { ChangeExtendTariffIdDto } from '../dto/requests/change-extend-tariff-id.dto';
import { TariffEntity } from '../../database/entities/tariff.entity';
import { TransactionEntity } from '../../database/entities/transaction.entity';
import { TransferDto } from '../dto/requests/transfer.dto';
import { logger } from '../../../common/logger/logger';

@Injectable()
export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly em: EntityManager,
    private readonly jwtService: JwtService,
    private readonly keyPurchaseService: KeyPurchaseService,
    private readonly xrayService: XrayService,
    private readonly transactionsService: TransactionsService,
  ) {}

  public async verifyTokenAsync(token: string): Promise<TokenType | undefined> {
    try {
      return this.jwtService.verifyAsync<TokenType>(token);
    } catch (error) {
      logger.error(error);
      return undefined;
    }
  }

  public async extendKey(
    body: ExtendKeyDto,
  ): Promise<UserResponseDto | undefined> {
    const result = await this.keyPurchaseService.renewKey(
      body.userId,
      body.keyId,
      body.tariffId,
    );

    if (!result.success && typeof result.data === 'string') return;

    return this.getUser(body.userId);
  }

  public async getServers() {
    const servers = await this.em.find(ServerEntity, {
      where: { canCreateKey: true, code: Not('white') },
    });

    return new DataResponse<GetServerDto[]>(
      GetServerDto.getManyFromServerEntities(servers),
    );
  }

  public async changeAutoRenew(
    userId: string,
    { keyId }: KeyIdDto,
  ): Promise<UserResponseDto> {
    await this.em
      .createQueryBuilder()
      .update(UserKeyEntity)
      .set({
        autoRenewEnabled: () => 'NOT auto_renew_enabled',
      })
      .where({ id: keyId, userId })
      .execute();

    return this.getUser(userId);
  }

  public async createKey(
    userId: string,
    tariffId: string,
  ): Promise<UserResponseDto | undefined> {
    const result = await this.keyPurchaseService.purchase(
      userId,
      tariffId,
      undefined,
      'xray',
    );

    if (!result.success && typeof result.data === 'string') return;

    return this.getUser(userId);
  }

  public async deleteKey(keyId: string): Promise<UserResponseDto | undefined> {
    const key = await this.em.findOne(UserKeyEntity, { where: { id: keyId } });
    if (!key) return;

    await this.em.softDelete(UserKeyEntity, { id: keyId });
    return this.getUser(key.userId);
  }

  public async getUser(
    id: string,
    manger: EntityManager = this.em,
  ): Promise<UserResponseDto> {
    const user = await manger.findOneOrFail(UserEntity, {
      where: { id },
      relations: ['keys', 'balanceAccount', 'keys.tariff', 'transactions'],
      order: {
        keys: { createdAt: 'DESC' },
        transactions: { createdAt: 'DESC' },
      },
    });

    return UserResponseDto.getFromUserEntity(user);
  }

  public async getKeyInfo(
    keyId: string,
  ): Promise<{ body: string; userinfo: string } | null> {
    const key = await this.em.findOne(UserKeyEntity, {
      where: { id: keyId },
      relations: ['user', 'tariff'],
    });
    if (!key) return null;

    const kindLabel = key.tariff?.kind === 'cdn' ? 'VIP' : 'BASE';
    let title = `🌐PassimX ${kindLabel} (ID ${StringsUtil.getShortName(keyId)})`;

    let uris: string = '';
    if (key.status === 'active') {
      const result = await this.xrayService.buildSubscriptionUri(
        key.id,
        key.user,
      );
      if (!result) return null;
      uris += result;
    } else title += ` (${this.keyPurchaseService.t(key.user, 'expired_key')})`;

    const body =
      `#profile-title: ${title}\n` +
      '#profile-update-interval: 12\n' +
      '#subscription-auto-update-enable: 1\n' +
      uris;

    const expire = Math.floor(new Date(key.expiresAt).getTime() / 1000);
    const download = Number(key.countTrafficUsed ?? 0);
    const limit = Number(key.countTrafficLimit ?? 0);
    const totalPart = limit > 0 ? `; total=${limit}` : '';
    const userinfo = `upload=0; download=${download}${totalPart}; expire=${expire}`;

    return { body, userinfo };
  }

  public async changeExtendTariffId(payload: ChangeExtendTariffIdDto) {
    if (payload.tariffId !== null) {
      const tariff = await this.em.findOne(TariffEntity, {
        where: { id: payload.tariffId, active: true },
      });
      if (!tariff) return;
    }

    await this.em.update(
      UserKeyEntity,
      { id: payload.keyId, userId: payload.userId },
      { autoExtendTariffId: payload.tariffId },
    );

    return this.getUser(payload.userId);
  }

  public userIsExists(id: string) {
    return this.em.exists(UserEntity, { where: { id: id } });
  }

  public async exchange(
    payload: ExchangeBalanceDto,
  ): Promise<UserResponseDto | undefined> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const account = await manager.findOne(BalanceAccount, {
          where: { userId: payload.userId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!account) return;

        if (
          !account[payload.from] ||
          account[payload.from] < payload.amountFrom
        )
          return;

        const amountTo = await this.transactionsService.convert(
          payload.amountFrom,
          payload.from,
          payload.to,
        );

        await this.transactionsService.decreaseBalance(
          payload.userId,
          payload.amountFrom,
          payload.from,
          manager,
        );

        await this.transactionsService.addBalance(
          payload.userId,
          amountTo,
          payload.to,
          manager,
          false,
          false,
        );

        await manager.insert(TransactionEntity, {
          amount: payload.amountFrom,
          currency: payload.from,
          userId: payload.userId,
          type: 'Debit',
          kind: 'Exchange',
          completed: true,
        });

        await manager.insert(TransactionEntity, {
          amount: amountTo,
          currency: payload.to,
          userId: payload.userId,
          type: 'Credit',
          kind: 'Exchange',
          completed: true,
        });

        return this.getUser(payload.userId, manager);
      });
    } catch (error) {
      logger.error(error);
    }
  }

  public async transfer(payload: TransferDto) {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const queryId = globalThis.crypto.randomUUID();

        const sortedIds = [payload.userId, payload.recipient].sort();

        const accountFirst = await manager.findOne(BalanceAccount, {
          where: { userId: sortedIds[0] },
          lock: { mode: 'pessimistic_write' },
        });

        const accountSecond = await manager.findOne(BalanceAccount, {
          where: { userId: sortedIds[1] },
          lock: { mode: 'pessimistic_write' },
        });

        const senderBalance =
          sortedIds[0] === payload.userId ? accountFirst : accountSecond;
        const recipientBalance =
          sortedIds[0] === payload.recipient ? accountFirst : accountSecond;

        if (!senderBalance || !recipientBalance) return;

        const amount = senderBalance[payload.currency];
        if (!amount || amount < payload.amount) return;

        await this.transactionsService.decreaseBalance(
          payload.userId,
          payload.amount,
          payload.currency,
          manager,
        );

        await this.transactionsService.addBalance(
          payload.recipient,
          payload.amount,
          payload.currency,
          manager,
          false,
          true,
        );
        await manager.insert(TransactionEntity, {
          currency: payload.currency,
          amount: payload.amount,
          kind: 'Transfer',
          type: 'Debit',
          completed: true,
          userId: payload.userId,
          meta: {
            queryId,
            comment: payload.comment,
          },
        });
        await manager.insert(TransactionEntity, {
          currency: payload.currency,
          amount: payload.amount,
          kind: 'Transfer',
          type: 'Credit',
          completed: true,
          userId: payload.recipient,
          meta: {
            queryId,
            comment: payload.comment,
          },
        });

        return this.getUser(payload.userId, manager);
      });
    } catch (error) {
      logger.error(error);
    }
  }

  public async createAccount(body: CreateAccountDto) {
    const id = crypto.randomUUID().replace(/-/g, '');
    await this.em.insert(UserEntity, {
      id,
      languageCode: body.languageCode,
    });

    await this.em.insert(BalanceAccount, {
      userId: id,
    });

    return this.getUser(id);
  }

  public async createToken(userId: string) {
    const payload = { userId, createdAt: Date.now() };
    return await this.jwtService.signAsync(payload);
  }

  public async getRefInfo(userId: string): Promise<DataResponse<RefInfoDto>> {
    const [users, allCount, activeCount] = await Promise.all([
      this.em
        .createQueryBuilder(UserEntity, 'u')
        .select('u2.id', 'id')
        .addSelect('COUNT(DISTINCT u.id)', 'allCount')
        .addSelect('COUNT(DISTINCT uk.user_id)', 'activeCount')
        .leftJoin(
          UserKeyEntity,
          'uk',
          "uk.user_id = u.id AND uk.status ='active'",
        )
        .innerJoin(UserEntity, 'u2', 'u2.id = u.source')
        .groupBy('u2.id, u2.created_at')
        .orderBy({
          '"activeCount"': 'DESC',
          '"allCount"': 'DESC',
          'u2.created_at': 'DESC',
        })
        .limit(5)
        .getRawMany<RefInfoUserItemDto>(),

      this.em.count(UserEntity, { where: { source: userId } }),
      this.em.count(UserEntity, {
        where: {
          source: userId,
          keys: { status: 'active' },
        },
      }),
    ]);

    return new DataResponse<RefInfoDto>({
      users,
      me: { id: userId, allCount, activeCount },
    });
  }
}
