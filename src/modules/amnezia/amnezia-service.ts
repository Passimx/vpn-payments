import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { EntityManager, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { ServerEntity } from '../database/entities/server.entity';

import { UserKeyEntity } from '../database/entities/user-key.entity';
import { TelegramService } from '../telegram/telegram-service';
import { UserEntity } from '../database/entities/user.entity';
import { I18nService } from '../i18n/i18n.service';
import { Context } from 'telegraf';
import { ServerDataType } from './types/server-data.type';
import { TariffEntity } from '../database/entities/tariff.entity';

@Injectable()
export class AmneziaService {
  constructor(
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    private readonly i18nService: I18nService,
    private readonly em: EntityManager,
  ) {}

  public async createXrayKey(user: UserEntity, tariffId: string) {
    try {
      const server = await this.getServer();
      if (!server) return;
      const tariff = await this.em.findOneOrFail(TariffEntity, {
        where: { id: tariffId },
      });

      const uuid = crypto.randomUUID();
      const key = await this.createKey(uuid, user, server);
      if (!key) return;

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + tariff.expirationDays);

      return {
        id: uuid,
        userId: user.id,
        serverId: server.id,
        key,
        protocol: 'xray',
        tariffId,
        createdAt: new Date(),
        expiresAt,
        status: 'active',
      } as UserKeyEntity;
    } catch (error) {
      console.error(error);
      return undefined;
    }
  }

  public async deleteXrayKey(keyEntity: UserKeyEntity) {
    const keyId = keyEntity.id;
    const server = keyEntity.server;

    const removed = await this.removeKey(server, keyId);
    if (!removed) return;

    await this.em.update(UserKeyEntity, { id: keyId }, { status: 'expired' });
    return true;
  }

  public async reactivateXrayKey(keyId: string): Promise<boolean> {
    const keyEntity = await this.em.findOne(UserKeyEntity, {
      where: { id: keyId },
      relations: ['server', 'user'],
    });
    if (!keyEntity || !keyEntity.server) return false;
    const server = keyEntity.server;

    const key = await this.createKey(keyId, keyEntity.user, server);
    return !!key;
  }

  public async migrateXrayKeyToAnotherServer(
    keyId: string,
    code: string,
  ): Promise<string | null> {
    const keyEntity = await this.em.findOne(UserKeyEntity, {
      where: {
        id: keyId,
        protocol: 'xray',
        status: 'active',
      },
      relations: ['server', 'user'],
    });
    if (!keyEntity || !keyEntity.server) return null;

    const oldServer = keyEntity.server;
    const newServer = await this.em.findOne(ServerEntity, {
      where: { code, canCreateKey: true },
    });

    if (!newServer) return null;

    const key = await this.createKey(keyId, keyEntity.user, newServer);
    if (!key) return null;

    await this.em.update(
      UserKeyEntity,
      {
        id: keyId,
      },
      {
        serverId: newServer.id,
        key,
      },
    );

    const checkAndDeleteKey = async () => {
      const userKey = await this.em.findOne(UserKeyEntity, {
        where: { id: keyId, serverId: oldServer.id },
      });

      if (!userKey) await this.removeKey(oldServer, keyId);
    };

    setTimeout(() => {
      checkAndDeleteKey();
    }, 60 * 1000);

    return key;
  }

  private async getServer() {
    const server = await this.em
      .createQueryBuilder(ServerEntity, 'servers')
      .select('servers.id')
      .where('servers.canDefaultCreateKey IS TRUE')
      .addSelect('COUNT(keys.id)', 'count')
      .leftJoin('servers.keys', 'keys', "keys.status = 'active'")
      .groupBy('servers.id')
      .orderBy('count', 'ASC')
      .getOne();

    return server
      ? this.em.findOne(ServerEntity, {
          where: { id: server.id },
        })
      : null;
  }

  public async checkAlmostExpiredKeys() {
    const nowPlusOneDay = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const users = await this.em.find(UserEntity, {
      where: {
        keys: {
          status: 'active',
          expiresAt: LessThanOrEqual(nowPlusOneDay),
        },
      },
      relations: ['keys', 'keys.server'],
    });

    for (const user of users) {
      await this.telegramService.sendAlmostExpiredKey(user);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  public async checkExpiredKeys() {
    const now = new Date();

    const expiredKeys = await this.em.find(UserKeyEntity, {
      where: {
        protocol: 'xray',
        status: 'active',
        expiresAt: LessThanOrEqual(now),
      },
      relations: ['server'],
    });

    for (const key of expiredKeys) {
      try {
        await this.deleteXrayKey(key);
        await new Promise((r) => setTimeout(r, 100));
      } catch (e) {
        console.error(
          '[AmneziaService] checkExpiredKeys error for key',
          key.id,
          e,
        );
      }
    }
  }

  public async syncActiveKeys(serverId?: string): Promise<number> {
    const now = new Date();

    const activeKeys = await this.em.find(UserKeyEntity, {
      where: {
        protocol: 'xray',
        status: 'active',
        expiresAt: MoreThanOrEqual(now),
        serverId: serverId ? serverId : undefined,
      },
    });

    let successCount = 0;

    for (const key of activeKeys) {
      try {
        const ok = await this.reactivateXrayKey(key.id);
        if (ok) successCount += 1;
      } catch (e) {
        console.error('Ошибка при восстановлении ключа', key.id, e);
      }
    }

    return successCount;
  }

  private async removeKey(server: ServerEntity, id: string): Promise<boolean> {
    const res = await fetch(`http://${server.host}:440/remove-user`, {
      method: 'POST',
      body: JSON.stringify({ id }),
      headers: { 'Content-Type': 'application/json' },
    });

    const payload = (await res.json()) as ServerDataType;
    return !!payload.id;
  }

  private async createKey(
    id: string,
    user: UserEntity,
    server: ServerEntity,
  ): Promise<string | null> {
    const keyName = `${this.t(user.languageCode, `${server.code}_flag`)} ${this.t(user.languageCode, `${server.code}_name`)} ID ${id.slice(0, 4)}...${id.slice(-4)}`;

    const res = await fetch(`http://${server.host}:440/add-user`, {
      method: 'POST',
      body: JSON.stringify({
        id,
        host: server.host,
        keyName: keyName,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    if (![200, 201].includes(res.status)) return null;
    const payload = (await res.json()) as ServerDataType;
    if (!payload.link) return null;
    return payload.link;
  }

  private t(ctx: Context | string | undefined, key: string) {
    return this.i18nService.t(
      typeof ctx === 'string' ? ctx : ctx?.from?.language_code,
      key,
    );
  }
}
