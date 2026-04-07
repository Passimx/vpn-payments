import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { EntityManager, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { ServerEntity } from '../database/entities/server.entity';

import { UserKeyEntity } from '../database/entities/user-key.entity';
import { TelegramService } from '../telegram/telegram-service';
import { UserEntity } from '../database/entities/user.entity';
import { I18nService } from '../i18n/i18n.service';
import { Context } from 'telegraf';
import { TariffEntity } from '../database/entities/tariff.entity';
import { KeyTrafficType, TrafficType } from './types/user-traffic.type';
import { logger } from '../../common/logger/logger';

@Injectable()
export class XrayService {
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
      relations: ['server', 'user'],
    });

    for (const key of expiredKeys) {
      try {
        await this.deleteXrayKey(key);
        await this.telegramService.sendMessageKeyExpired(key.id);
        await new Promise((r) => setTimeout(r, 100));
      } catch (e) {
        console.error(
          '[XrayService] checkExpiredKeys error for key',
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

  public async getStats(
    server: ServerEntity,
  ): Promise<KeyTrafficType[] | null> {
    const commands = [
      'xray api statsquery --server=127.0.0.1:10085 -reset=true',
    ];

    const payload = await this.runCommands(server, commands);
    if (!payload) return null;

    const traffic = JSON.parse(payload[0]) as TrafficType;
    const statsMap = {};
    for (const item of traffic.stat || []) {
      const match = item.name.match(
        /^user>>>(.*?)>>>traffic>>>(uplink|downlink)$/,
      );

      if (!match) continue;

      const [, id, type] = match;
      const value = Number(item.value || 0);

      if (!statsMap[id]) {
        statsMap[id] = {
          id,
          uplink: 0,
          downlink: 0,
        };
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      statsMap[id][type] = value;
    }

    return Object.values(statsMap);
  }

  private async removeKey(server: ServerEntity, id: string): Promise<boolean> {
    const commands = [
      `xray api rmu --server=127.0.0.1:10085 --tag=vless-in "${id}"`,
      `xray api stats --server=127.0.0.1:10085 --name "user>>>${id}>>>traffic>>>downlink" -reset=true`,
      `xray api stats --server=127.0.0.1:10085 --name "user>>>${id}>>>traffic>>>uplink" --reset=true`,
      `rm -R /xray/data/users/${id}.json`,
    ];

    const payload = await this.runCommands(server, commands);
    return !!payload;
  }

  private async createKey(
    id: string,
    user: UserEntity,
    server: ServerEntity,
  ): Promise<string | null> {
    const dataCommands = [
      'cat /xray/data/public.key',
      'cat /xray/data/server.name',
      'cat /xray/data/server.port',
      'cat /xray/data/short_id.key',
    ];

    const data = await this.runCommands(server, dataCommands);
    if (!data) return null;
    const [publicKey, sni, port, shortId] = data.map((v) => v.trim());

    const commands = [
      `mkdir -p /xray/data/users`,
      `echo '{"inbounds":[{"tag":"vless-in","port":${port},"protocol":"vless","settings":{"clients":[{"id":"${id}","email":"${id}","flow":"xtls-rprx-vision","level":0}],"decryption":"none"}}]}' > /xray/data/users/${id}.json`,
      `xray api adu --server=127.0.0.1:10085 /xray/data/users/${id}.json`,
    ];
    const result = await this.runCommands(server, commands);
    if (!result) return null;
    const keyName = `${this.t(user.languageCode, `${server.code}_flag`)} ${this.t(user.languageCode, `${server.code}_name`)} ID ${id.slice(0, 4)}...${id.slice(-4)}`;
    return `vless://${id}@${server.host}:${port}?encryption=none&security=reality&sni=${sni}&fp=chrome&pbk=${publicKey}&sid=${shortId}&type=tcp&headerType=none&flow=xtls-rprx-vision#${encodeURIComponent(keyName)}`;
  }

  private async runCommands(
    server: ServerEntity,
    commands: string[],
  ): Promise<string[] | null> {
    const res = await fetch(`http://${server.host}:440/commands`, {
      method: 'POST',
      body: JSON.stringify({ commands }),
      headers: { 'Content-Type': 'application/json' },
    }).catch(logger.error);

    if (!res) return null;
    if (![200, 201].includes(res.status)) {
      logger.error(await res.json());
      return null;
    }
    return (await res.json()) as string[];
  }

  private t(ctx: Context | string | undefined, key: string) {
    return this.i18nService.t(
      typeof ctx === 'string' ? ctx : ctx?.from?.language_code,
      key,
    );
  }
}
