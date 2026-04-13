import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { EntityManager, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { ServerEntity } from '../database/entities/server.entity';

import { UserKeyEntity } from '../database/entities/user-key.entity';
import { TelegramService } from '../telegram/telegram-service';
import { UserEntity } from '../database/entities/user.entity';
import { I18nService } from '../i18n/i18n.service';
import { TariffEntity } from '../database/entities/tariff.entity';
import { TrafficEntity } from '../database/entities/ traffic.entity';
import { KeyTrafficType, TrafficType } from './types/user-traffic.type';
import { logger } from '../../common/logger/logger';

type CreateXrayKeyOptions = { inboundTag?: string; linkPort?: number };

const VALID_INBOUND_TAG_RE = /^[a-zA-Z0-9_.-]+$/;

@Injectable()
export class XrayService {
  constructor(
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    private readonly i18nService: I18nService,
    private readonly em: EntityManager,
  ) {}

  public async createXrayKey(
    user: UserEntity,
    tariffId: string,
    options?: CreateXrayKeyOptions,
  ) {
    try {
      const tariff = await this.em.findOneOrFail(TariffEntity, {
        where: { id: tariffId },
      });

      let cascadeToServerId: string | null = null;
      let server: ServerEntity | null;
      let keyOpts = options;

      if (tariff.trafficLimit) {
        server = await this.em.findOne(ServerEntity, {
          where: { code: 'white' },
        });
        if (!server) {
          logger.error(`Первый сервер(российский) не был найден`);
          return;
        }
        const eu = await this.getServer();
        if (!eu) {
          logger.error('Второй сервер для каскадного соединения не был найден');
          return;
        }
        if (keyOpts === undefined) {
          const fromEu = this.euCascadeOptsFromServer(eu);
          if (!fromEu) {
            logger.error(
              `Каскад: у EU-сервера (${eu.code}) в servers задайте forCascadeInboundTag и port`,
            );
            return;
          }
          keyOpts = fromEu;
        }
        cascadeToServerId = eu.id;
      } else {
        server = await this.getServer();
        if (!server) return;
      }

      const uuid = crypto.randomUUID();
      const key = await this.createKey(uuid, user, server, keyOpts);
      if (!key) return;

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + tariff.expirationDays);

      return {
        id: uuid,
        userId: user.id,
        serverId: server.id,
        countTrafficLimit: tariff.trafficLimit ?? null,
        key,
        protocol: 'xray',
        tariffId,
        createdAt: new Date(),
        expiresAt,
        status: 'active',
        cascadeToServerId,
      } as UserKeyEntity;
    } catch (error) {
      console.error(error);
      return undefined;
    }
  }

  public async deleteXrayKey(keyEntity: UserKeyEntity) {
    const keyId = keyEntity.id;
    const server = keyEntity.server;
    const inboundTag = await this.resolveRmuInboundTag(keyEntity);

    const removed = await this.removeKey(server, keyId, inboundTag);
    if (!removed) return;

    await this.em.update(UserKeyEntity, { id: keyId }, { status: 'expired' });
    return true;
  }

  public async reactivateXrayKey(keyId: string): Promise<boolean> {
    const keyEntity = await this.em.findOne(UserKeyEntity, {
      where: { id: keyId },
      relations: ['server', 'user', 'cascadeToServer'],
    });
    if (!keyEntity || !keyEntity.server) return false;

    let keyOpts: CreateXrayKeyOptions | undefined;
    if (keyEntity.cascadeToServerId) {
      const eu = await this.getCascadeEuServer(keyEntity);
      if (!eu) {
        logger.error(
          `[reactivateXrayKey] ключ ${keyId}: не найден EU (cascade_to_server_id)`,
        );
        return false;
      }
      const fromEu = this.euCascadeOptsFromServer(eu);
      if (!fromEu) {
        logger.error(
          `[reactivateXrayKey] ключ ${keyId}: у EU (${eu.code}) задайте forCascadeInboundTag и port`,
        );
        return false;
      }
      keyOpts = fromEu;
    }

    const key = await this.createKey(
      keyId,
      keyEntity.user,
      keyEntity.server,
      keyOpts,
    );
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

    const inboundTagForOldHost = await this.resolveRmuInboundTag(keyEntity);

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

      if (!userKey)
        await this.removeKey(oldServer, keyId, inboundTagForOldHost);
    };

    setTimeout(() => {
      checkAndDeleteKey();
    }, 60 * 1000);

    return key;
  }

  private euCascadeOptsFromServer(
    eu: ServerEntity,
  ): CreateXrayKeyOptions | null {
    const tag = eu.forCascadeInboundTag?.trim();
    const port = eu.port;
    if (!tag || port == null || port < 1 || port > 65535) return null;
    return { inboundTag: tag, linkPort: port };
  }

  /** EU-строка для каскада: уже в `relations` или одна загрузка по id. */
  private getCascadeEuServer(key: UserKeyEntity): Promise<ServerEntity | null> {
    const id = key.cascadeToServerId;
    if (!id) return Promise.resolve(null);
    if (key.cascadeToServer) return Promise.resolve(key.cascadeToServer);
    return this.em.findOne(ServerEntity, { where: { id } });
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
      relations: ['server', 'user', 'cascadeToServer'],
    });

    for (const key of expiredKeys) {
      try {
        const removed = await this.deleteXrayKey(key);
        if (!removed) continue;
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

  public async checkPremiumTrafficLimitExceeded(): Promise<void> {
    const keys = await this.em
      .createQueryBuilder(UserKeyEntity, 'k')
      .innerJoinAndSelect('k.server', 'server')
      .leftJoinAndSelect('k.cascadeToServer', 'cascadeToServer')
      .where(
        'k.protocol = :p AND k.status = :st AND k.countTrafficLimit IS NOT NULL',
        {
          p: 'xray',
          st: 'active',
        },
      )
      .getMany();

    for (const key of keys) {
      const limit = key.countTrafficLimit;
      if (limit == null || limit <= 0) continue;

      const row = await this.em
        .createQueryBuilder(TrafficEntity, 't')
        .select('COALESCE(SUM(t.downLink), 0)', 'total')
        .where('t.keyId = :kid', { kid: key.id })
        .getRawOne<{ total: string | number }>();

      const used = Number(row?.total ?? 0);
      if (used < limit) continue;

      try {
        if (!(await this.deleteXrayKey(key))) continue;
        await this.telegramService.sendMessageKeyTrafficLimitExceeded(key.id);
        await new Promise((r) => setTimeout(r, 100));
      } catch (e) {
        logger.error(
          'Ошибка отправки сообщения об исчерпании трафика премиум ключа',
          key.id,
          e,
        );
      }
    }
  }

  // Статистика потребления Premium-трафика в формате `1,55 Gb / 5,00 Gb`.
  public async getPremiumTrafficProgress(
    keyId: string,
    limitBytes: number | null | undefined,
  ): Promise<string | null> {
    if (!limitBytes || limitBytes <= 0) return null;

    const row = await this.em
      .createQueryBuilder(TrafficEntity, 't')
      .select('COALESCE(SUM(t.downLink), 0)', 'used')
      .where('t.keyId = :keyId', { keyId })
      .getRawOne<{ used: string | number }>();

    const usedBytes = Number(row?.used ?? 0);
    const toGb = (bytes: number) =>
      (Math.max(bytes, 0) / 1024 / 1024 / 1024).toFixed(2).replace('.', ',');
    return `${toGb(usedBytes)} Gb / ${toGb(limitBytes)} Gb`;
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

  /** Каскад: тег с EU; иначе или при битых данных — `vless-in`. */
  private async resolveRmuInboundTag(key: UserKeyEntity): Promise<string> {
    const cascadeId = key.cascadeToServerId;
    const eu = await this.getCascadeEuServer(key);

    const raw = eu?.forCascadeInboundTag?.trim() ?? '';
    const validRaw = VALID_INBOUND_TAG_RE.test(raw);

    if (cascadeId && !validRaw)
      logger.error(
        `ключ ${key.id}: каскад, forCascadeInboundTag пустой или невалиден ${raw}, с vless-in`,
      );

    return cascadeId && validRaw ? raw : 'vless-in';
  }

  private async removeKey(
    server: ServerEntity,
    id: string,
    inboundTag: string,
  ): Promise<boolean> {
    const commands = [
      `xray api rmu --server=127.0.0.1:10085 --tag=${inboundTag} "${id}"`,
      `rm -R /xray/data/users/${id}.json`,
    ];

    const payload = await this.runCommands(server, commands);
    return !!payload;
  }

  private async createKey(
    id: string,
    user: UserEntity,
    server: ServerEntity,
    options?: CreateXrayKeyOptions,
  ): Promise<string | null> {
    const dataCommands = [
      'cat /xray/data/public.key',
      'cat /xray/data/server.name',
      'cat /xray/data/server.port',
      'cat /xray/data/short_id.key',
    ];

    const data = await this.runCommands(server, dataCommands);
    if (!data) return null;
    const [publicKey, sni, defaultPort, shortId] = data.map((v) => v.trim());

    const inboundTag = options?.inboundTag ?? 'vless-in';
    if (!VALID_INBOUND_TAG_RE.test(inboundTag)) {
      logger.error(`[createKey] недопустимый inboundTag "${inboundTag}"`);
      return null;
    }
    const port = String(options?.linkPort ?? defaultPort).trim();
    if (!/^\d+$/.test(port)) return null;

    const commands = [
      `mkdir -p /xray/data/users`,
      `echo '{"inbounds":[{"tag":"${inboundTag}","listen":"0.0.0.0","port":${port},"protocol":"vless","settings":{"clients":[{"id":"${id}","email":"${id}","flow":"xtls-rprx-vision","level":0}],"decryption":"none"}}]}' > /xray/data/users/${id}.json`,
      `xray api adu --server=127.0.0.1:10085 /xray/data/users/${id}.json`,
    ];
    const result = await this.runCommands(server, commands);
    if (!result) return null;
    const keyName = `${this.t(user, `${server.code}_flag`)} ${this.t(user, `${server.code}_name`)} ID ${id.slice(0, 4)}...${id.slice(-4)}`;
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

  private t(ctx: UserEntity | string, key: string) {
    let lang = 'en';

    if (typeof ctx === 'string') lang = ctx;
    else if (ctx.languageCode) lang = ctx.languageCode;

    return this.i18nService.t(lang, key);
  }
}
