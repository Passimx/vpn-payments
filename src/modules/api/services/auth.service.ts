import { Injectable } from '@nestjs/common';
import { EntityManager, IsNull, Not } from 'typeorm';
import { UserEntity } from '../../database/entities/user.entity';
import { DataResponse } from '../dto/responses/data-response.dto';
import { JwtService } from '@nestjs/jwt';
import { TokenType } from '../types/token.type';
import { UserResponseDto } from '../dto/responses/user.dto';
import { TariffEntity } from '../../database/entities/tariff.entity';
import { GetTariffsDto } from '../dto/requests/get-tariffs.dto';
import { ExtendKeyDto } from '../dto/requests/extend-key.dto';
import { KeyPurchaseService } from '../../key-purchase/key-purchase.service';
import { UserKeyEntity } from '../../database/entities/user-key.entity';

@Injectable()
export class AuthService {
  private readonly loginUserKey = new Map<string, string>();

  constructor(
    private readonly em: EntityManager,
    private readonly jwtService: JwtService,
    private readonly keyPurchaseService: KeyPurchaseService,
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

  public async getUsersMe(id: string) {
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
  ): Promise<DataResponse<string | UserKeyEntity>> {
    const result = await this.keyPurchaseService.renewKey(
      userId,
      body.keyId,
      body.tariffId,
    );

    if (!result.success && typeof result.data === 'string')
      return new DataResponse(result.data);

    const key = await this.em.findOneOrFail(UserKeyEntity, {
      where: { userId, id: body.keyId },
    });

    return new DataResponse<UserKeyEntity>(key);
  }

  private getUser(id: string) {
    return this.em.findOneOrFail(UserEntity, {
      where: { id },
      relations: ['keys', 'keys.server', 'balanceAccount'],
      order: { keys: { createdAt: 'ASC' } },
    });
  }
}
