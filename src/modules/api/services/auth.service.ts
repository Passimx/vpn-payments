import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, MoreThanOrEqual, Not } from 'typeorm';
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
import {
  BalanceAccount,
  scale,
} from '../../database/entities/balance-account.entity';
import { CreateAccountDto } from '../dto/requests/create-account.dto';
import { StringsUtil } from '../../../common/utils/strings.util';
import { ExchangeBalanceDto } from '../dto/requests/exchange-balance.dto';
import { TransactionsService } from '../../transactions/transactions.service';
import { ChangeExtendTariffIdDto } from '../dto/requests/change-extend-tariff-id.dto';
import { TariffEntity } from '../../database/entities/tariff.entity';
import { TransactionEntity } from '../../database/entities/transaction.entity';
import { TransferDto } from '../dto/requests/transfer.dto';
import { logger } from '../../../common/logger/logger';
import { CreateKeyDto } from '../dto/requests/create-key.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
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
    const result = await this.keyPurchaseService.renewKey(body);

    if (!result.success && typeof result.data === 'string') return;

    return this.getUser(body.userId);
  }

  public async getServers() {
    const servers = await this.dataSource.manager.find(ServerEntity, {
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
    await this.dataSource.manager
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
    body: CreateKeyDto,
  ): Promise<UserResponseDto | undefined> {
    const result = await this.keyPurchaseService.purchase(body);

    if (!result.success && typeof result.data === 'string') return;

    return this.getUser(body.userId);
  }

  public async deleteKey(keyId: string): Promise<UserResponseDto | undefined> {
    const key = await this.dataSource.manager.findOne(UserKeyEntity, {
      where: { id: keyId },
    });
    if (!key) return;

    await this.dataSource.manager.softDelete(UserKeyEntity, { id: keyId });
    return this.getUser(key.userId);
  }

  public async getUser(
    id: string,
    manger: EntityManager = this.dataSource.manager,
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
    const key = await this.dataSource.manager.findOne(UserKeyEntity, {
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
      const tariff = await this.dataSource.manager.findOne(TariffEntity, {
        where: { id: payload.tariffId, active: true },
      });
      if (!tariff) return;
    }

    await this.dataSource.manager.update(
      UserKeyEntity,
      { id: payload.keyId, userId: payload.userId },
      { autoExtendTariffId: payload.tariffId },
    );

    return this.getUser(payload.userId);
  }

  public userIsExists(id: string) {
    return this.dataSource.manager.exists(UserEntity, { where: { id: id } });
  }

  public async exchange(
    payload: ExchangeBalanceDto,
  ): Promise<UserResponseDto | undefined> {
    const amountTo = await this.transactionsService.convert(
      payload.amountFrom,
      payload.from,
      payload.to,
    );
    if (!amountTo) return;

    try {
      return await this.dataSource.transaction(async (manager) => {
        const account = await manager.findOne(BalanceAccount, {
          where: { userId: payload.userId, seqno: payload.seqno },
          lock: { mode: 'pessimistic_write' },
        });

        if (!account) return;

        if (
          !account[payload.from] ||
          account[payload.from] < payload.amountFrom
        )
          return;

        await Promise.all([
          this.transactionsService.decreaseBalance(
            payload.userId,
            payload.amountFrom,
            payload.from,
            manager,
          ),
          this.transactionsService.addBalance(
            payload.userId,
            amountTo,
            payload.to,
            manager,
          ),
          manager.insert(TransactionEntity, {
            amount: payload.amountFrom,
            currency: payload.from,
            userId: payload.userId,
            type: 'Debit',
            kind: 'Exchange',
            completed: true,
          }),
        ]);

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
    if (
      !payload.userId?.length ||
      !payload.recipient?.length ||
      !payload.seqno ||
      !payload.amount ||
      payload.amount <= 0 ||
      payload.userId === payload.recipient
    )
      return;

    const decimalParts = payload.amount.toString().split('.');
    if (decimalParts[1] && decimalParts[1].length > scale) return;

    try {
      const success = await this.dataSource.transaction(async (manager) => {
        const queryId = globalThis.crypto.randomUUID();

        const accounts = await manager.find(BalanceAccount, {
          where: [
            { userId: payload.recipient },
            {
              userId: payload.userId,
              seqno: payload.seqno,
              [payload.currency]: MoreThanOrEqual(payload.amount),
            },
          ],
          lock: { mode: 'pessimistic_write' },
        });

        if (accounts?.length !== 2) return false;

        await Promise.all([
          this.transactionsService.decreaseBalance(
            payload.userId,
            payload.amount,
            payload.currency,
            manager,
          ),
          this.transactionsService.addBalance(
            payload.recipient,
            payload.amount,
            payload.currency,
            manager,
          ),
          manager.insert(TransactionEntity, [
            {
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
              createdAt: () => 'CURRENT_TIMESTAMP',
            },
            {
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
              createdAt: () => "CURRENT_TIMESTAMP + INTERVAL '1 microsecond'",
            },
          ]),
        ]);
        return true;
      });

      if (success) return this.getUser(payload.userId);
    } catch (error) {
      logger.error(error);
    }
  }

  public async createAccount(body: CreateAccountDto) {
    const id = crypto.randomUUID().replace(/-/g, '');
    await this.dataSource.manager.insert(UserEntity, {
      id,
      languageCode: body.languageCode,
    });

    await this.dataSource.manager.insert(BalanceAccount, {
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
      this.dataSource.manager
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

      this.dataSource.manager.count(UserEntity, { where: { source: userId } }),
      this.dataSource.manager.count(UserEntity, {
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
