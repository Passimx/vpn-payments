import { Injectable } from '@nestjs/common';
import { EntityManager, IsNull, Not } from 'typeorm';
import { UserEntity } from '../../database/entities/user.entity';
import { DataResponse } from '../dto/responses/data-response.dto';
import { JwtService } from '@nestjs/jwt';
import { TokenType } from '../types/token.type';
import { UserKeyDto, UserResponseDto } from '../dto/responses/user.dto';
import { TariffEntity } from '../../database/entities/tariff.entity';
import { GetTariffsDto } from '../dto/requests/get-tariffs.dto';
import { ExtendKeyDto } from '../dto/requests/extend-key.dto';
import { KeyPurchaseService } from '../../key-purchase/key-purchase.service';
import { UserKeyEntity } from '../../database/entities/user-key.entity';
import { ServerEntity } from '../../database/entities/server.entity';
import { GetServerDto } from '../dto/responses/get-server.dto';
import { ChangeServerDto } from '../dto/requests/change-server.dto';
import { XrayService } from '../../xray/xray-service';
import { CreateKeyBody } from '../dto/requests/create-key.body';

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

    const user = await this.getUser(userId);
    if (!user) return new DataResponse('not_found');

    const payload = { userId: user.id, createdAt: Date.now() };
    const token = await this.jwtService.signAsync(payload);

    return new DataResponse({ token });
  }

  public setKey(key: string, userId: string) {
    this.loginUserKey.set(key, userId);
  }

  public async getUsersMe(id: string): Promise<DataResponse<UserResponseDto>> {
    const user = await this.getUser(id);

    return new DataResponse<UserResponseDto>(
      UserResponseDto.getFromUserEntity(user),
    );
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
        ? { active: true, trafficLimit: Not(IsNull()) }
        : { active: true, trafficLimit: IsNull() };

    const tariffs = await this.em.find(TariffEntity, {
      where,
      order: { price: 'ASC' },
    });

    return new DataResponse<TariffEntity[]>(tariffs);
  }

  public async extendKey(
    userId: string,
    body: ExtendKeyDto,
  ): Promise<DataResponse<string | UserKeyDto>> {
    const result = await this.keyPurchaseService.renewKey(
      userId,
      body.keyId,
      body.tariffId,
    );

    if (!result.success && typeof result.data === 'string')
      return new DataResponse(result.data);

    const key = await this.em.findOneOrFail(UserKeyEntity, {
      where: { userId, id: body.keyId },
      relations: ['server'],
    });

    return new DataResponse<UserKeyDto>(UserKeyDto.getFromUserKey(key));
  }

  public async getServers() {
    const servers = await this.em.find(ServerEntity, {
      where: { canCreateKey: true, code: Not('white') },
    });

    return new DataResponse<GetServerDto[]>(
      GetServerDto.getManyFromServerEntities(servers),
    );
  }

  public async changeServer(
    userId: string,
    body: ChangeServerDto,
  ): Promise<DataResponse<string | UserKeyDto>> {
    const response = await this.xrayService.migrateXrayKeyToAnotherServer(
      body.keyId,
      body.serverId,
    );

    if (!response) return new DataResponse('error');

    const key = await this.em.findOneOrFail(UserKeyEntity, {
      where: { userId, id: body.keyId },
      relations: ['server'],
    });

    return new DataResponse<UserKeyDto>(UserKeyDto.getFromUserKey(key));
  }

  public async createKey(
    userId: string,
    body: CreateKeyBody,
  ): Promise<DataResponse<string | UserKeyDto>> {
    const result = await this.keyPurchaseService.purchase(
      userId,
      body.tariffId,
      undefined,
      'xray',
    );

    if (!result.success && typeof result.data === 'string')
      return new DataResponse(result.data);

    if (typeof result.data !== 'string') {
      const key = await this.em.findOneOrFail(UserKeyEntity, {
        where: { key: result.data.uri },
        relations: ['server'],
      });

      return new DataResponse<UserKeyDto>(UserKeyDto.getFromUserKey(key));
    }

    return new DataResponse(result.data);
  }

  // public async deleteKey(
  //   userId: string,
  //   body: DeleteKeyDto,
  // ): Promise<DataResponse<string | boolean>> {}

  private getUser(id: string) {
    return this.em.findOneOrFail(UserEntity, {
      where: { id },
      relations: ['keys', 'keys.server', 'balanceAccount'],
      order: { keys: { createdAt: 'ASC' } },
    });
  }
}
