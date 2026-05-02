import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { UserEntity } from '../../database/entities/user.entity';
import { DataResponse } from '../dto/responses/data-response.dto';
import { JwtService } from '@nestjs/jwt';
import { TokenType } from '../types/token.type';
import { UserResponseDto } from '../dto/responses/user.dto';

@Injectable()
export class AuthService {
  private readonly loginUserKey = new Map<string, string>();

  constructor(
    private readonly em: EntityManager,
    private readonly jwtService: JwtService,
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

  async verifyTokenAsync(token: string): Promise<TokenType | undefined> {
    try {
      return this.jwtService.verifyAsync<TokenType>(token);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      return undefined;
    }
  }

  private getUser(id: string) {
    return this.em.findOneOrFail(UserEntity, {
      where: { id },
      relations: ['keys', 'keys.server', 'balanceAccount'],
    });
  }
}
