import { Injectable } from '@nestjs/common';
import { EntityManager, Not } from 'typeorm';
import { UserEntity } from '../../database/entities/user.entity';
import { DataResponse } from '../dto/responses/data-response.dto';
import { JwtService } from '@nestjs/jwt';
import { TokenType } from '../types/token.type';
import { UserResponseDto } from '../dto/responses/user.dto';
import { TariffEntity } from '../../database/entities/tariff.entity';
import { GetTariffsDto } from '../dto/requests/get-tariffs.dto';
import { ExtendKeyDto } from '../dto/requests/extend-key.dto';
import { KeyPurchaseService } from '../../key-purchase/key-purchase.service';
import { ServerEntity } from '../../database/entities/server.entity';
import { GetServerDto } from '../dto/responses/get-server.dto';
import { XrayService } from '../../xray/xray-service';
import { CreateKeyBody } from '../dto/requests/create-key.body';
import { UserKeyEntity } from '../../database/entities/user-key.entity';
import { KeyIdDto } from '../dto/requests/key-id.dto';
import { RefInfoDto, RefInfoUserItemDto } from '../dto/responses/ref-info.dto';
import { BalanceAccount } from '../../database/entities/balance-account.entity';
import { CreateAccountDto } from '../dto/requests/create-account.dto';
import { StringsUtil } from '../../../common/utils/strings.util';

@Injectable()
export class AuthService {
  private readonly loginUserKey = new Map<string, string>();

  constructor(
    private readonly em: EntityManager,
    private readonly jwtService: JwtService,
    private readonly keyPurchaseService: KeyPurchaseService,
    private readonly xrayService: XrayService,
  ) {}

  public async loginByTelegram(key: string) {
    const userId = this.loginUserKey.get(key);
    if (!userId) return new DataResponse('not_found');
    this.loginUserKey.delete(key);

    const user = await this.em.findOneOrFail(UserEntity, {
      where: { id: userId },
    });

    if (!user) return new DataResponse('not_found');

    const payload = { userId: user.id, createdAt: Date.now() };
    const token = await this.jwtService.signAsync(payload);

    return new DataResponse({ token });
  }

  public setKey(key: string, userId: string) {
    this.loginUserKey.set(key, userId);
  }

  public async verifyTokenAsync(token: string): Promise<TokenType | undefined> {
    try {
      return this.jwtService.verifyAsync<TokenType>(token);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      return undefined;
    }
  }

  public async getTariffs({
    kind,
  }: GetTariffsDto): Promise<DataResponse<TariffEntity[]>> {
    const where =
      kind === 'premium'
        ? { active: true, useCascade: true }
        : { active: true, useCascade: false };

    const tariffs = await this.em.find(TariffEntity, {
      where,
      order: { price: 'ASC' },
    });

    return new DataResponse<TariffEntity[]>(tariffs);
  }

  public async extendKey(
    userId: string,
    body: ExtendKeyDto,
  ): Promise<DataResponse<string | UserResponseDto>> {
    const result = await this.keyPurchaseService.renewKey(
      userId,
      body.keyId,
      body.tariffId,
    );

    if (!result.success && typeof result.data === 'string')
      return new DataResponse(result.data);

    return this.getUser(userId);
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
  ): Promise<DataResponse<string | UserResponseDto>> {
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
    body: CreateKeyBody,
  ): Promise<DataResponse<string | UserResponseDto>> {
    const result = await this.keyPurchaseService.purchase(
      userId,
      body.tariffId,
      undefined,
      'xray',
    );

    if (!result.success && typeof result.data === 'string')
      return new DataResponse(result.data);

    return this.getUser(userId);
  }

  public async deleteKey(
    userId: string,
    body: KeyIdDto,
  ): Promise<DataResponse<string | UserResponseDto>> {
    await this.em.softDelete(UserKeyEntity, { id: body.keyId, userId });

    return this.getUser(userId);
  }

  public async getUser(id: string): Promise<DataResponse<UserResponseDto>> {
    const user = await this.em.findOneOrFail(UserEntity, {
      where: { id },
      relations: ['keys', 'balanceAccount'],
      order: { keys: { createdAt: 'ASC' } },
    });

    return new DataResponse<UserResponseDto>(
      UserResponseDto.getFromUserEntity(user),
    );
  }

  public async getKeyInfo(
    keyId: string,
  ): Promise<{ body: string; userinfo: string } | null> {
    let title = `🌐PassimX VPN (ID ${StringsUtil.getShortName(keyId)})`;

    const key = await this.em.findOne(UserKeyEntity, {
      where: { id: keyId },
      relations: ['user'],
    });
    if (!key) return null;

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

  public async createAccount(body: CreateAccountDto) {
    const id = crypto.randomUUID().replace(/-/g, '');
    await this.em.insert(UserEntity, {
      id,
      languageCode: body.languageCode,
    });

    await this.em.insert(BalanceAccount, {
      userId: id,
    });

    const user = await this.em.findOne(UserEntity, { where: { id } });
    if (!user) return new DataResponse('not_found');

    const payload = { userId: user.id, createdAt: Date.now() };
    const token = await this.jwtService.signAsync(payload);

    return new DataResponse({ token });
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
