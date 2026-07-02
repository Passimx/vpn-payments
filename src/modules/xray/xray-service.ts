import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  DataSource,
  EntityManager,
  IsNull,
  LessThanOrEqual,
  Not,
} from 'typeorm';
import { ServerEntity } from '../database/entities/server.entity';

import { UserKeyEntity } from '../database/entities/user-key.entity';
import { TelegramService } from '../telegram/telegram-service';
import { UserEntity } from '../database/entities/user.entity';
import { I18nService } from '../i18n/i18n.service';
import { TariffEntity } from '../database/entities/tariff.entity';
import { KeyTrafficType, TrafficType } from './types/user-traffic.type';
import { logger } from '../../common/logger/logger';
import { CreateServerDto } from './dto/create-server.dto';
import { CreateXrayKeyOptions } from './types/create-xray-key-options.type';

const VALID_INBOUND_TAG_RE = /^[a-zA-Z0-9_.-]+$/;

const SERVER_PARAMS_TTL_MS = 60 * 60 * 1000; // 1 hour — success and failure
const SERVER_PARAM_COMMANDS = [
  'cat /xray/data/public.key',
  'cat /xray/data/server.name',
  'cat /xray/data/server.port',
  'cat /xray/data/short_id.key',
];

@Injectable()
export class XrayService implements OnModuleInit {
  private readonly serverParamsCache = new Map<
    string,
    { data: string[] | null; fetchedAt: number }
  >();

  constructor(
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    private readonly i18nService: I18nService,
    private readonly em: EntityManager,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    const servers = await this.em.find(ServerEntity, {
      where: { canCreateKey: true, code: Not('white') },
    });
    // Прогреваем reality-параметры всех серверов (совмещённый сервер = reality + CDN).
    await Promise.allSettled(servers.map((s) => this.warmServerParamsCache(s)));
    const ok = [...this.serverParamsCache.values()].filter(
      (c) => c.data,
    ).length;
    logger.info(`[XrayService] server params cache: ${ok}/${servers.length}`);
  }

  private async warmServerParamsCache(server: ServerEntity): Promise<void> {
    const t = Date.now();
    const data = await this.fetchServerParams(server);
    this.serverParamsCache.set(server.id, {
      data: data ?? null,
      fetchedAt: Date.now(),
    });
    const ms = Date.now() - t;
    if (data) {
      logger.info(`[XrayService] ✅ cached ${server.code} in ${ms}ms`);
    } else {
      logger.error(
        `[XrayService] ❌ failed to cache ${server.code} after ${ms}ms`,
      );
    }
  }

  private fetchServerParams(server: ServerEntity) {
    return this.runCommands(server, SERVER_PARAM_COMMANDS);
  }

  private async getServerParams(
    server: ServerEntity,
  ): Promise<string[] | null> {
    const cached = this.serverParamsCache.get(server.id);
    const now = Date.now();
    if (cached && now - cached.fetchedAt < SERVER_PARAMS_TTL_MS) {
      return cached.data;
    }
    const data = await this.fetchServerParams(server);
    this.serverParamsCache.set(server.id, {
      data: data ?? null,
      fetchedAt: now,
    });
    return data;
  }

  public async createXrayKey(
    user: UserEntity,
    tariff: TariffEntity,
    manager: EntityManager,
  ): Promise<UserKeyEntity | undefined> {
    try {
      let cascadeToServerId: string | null = null;
      const uuid = crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + tariff.expirationDays);

      if (tariff.kind === 'cascade') {
        const eu = await manager.findOne(ServerEntity, {
          where: { canDefaultCreateKey: true },
        });
        if (!eu) {
          logger.error('Второй сервер для каскадного соединения не был найден');
          return;
        }
        cascadeToServerId = eu.id;
      }

      const key = {
        id: uuid,
        userId: user.id,
        countTrafficLimit: tariff.trafficLimit,
        protocol: 'xray',
        tariffId: tariff.id,
        expiresAt,
        cascadeToServerId,
      } as UserKeyEntity;

      await manager.insert(UserKeyEntity, key);

      const targets = await this.getKeyTargets(key, manager);

      for (const { host, exit, isCdn } of targets) {
        const result = await this.createKey(key, host, exit, isCdn);
        if (!result)
          throw new BadRequestException(`Unable to create key: ${host.id}`);
      }

      return key;
    } catch (error) {
      console.error(error);
      return;
    }
  }

  public async deleteXrayKey(
    keyEntity: UserKeyEntity,
    manager: EntityManager = this.em,
  ) {
    const keyId = keyEntity.id;
    const targets = await this.getKeyTargets(keyEntity);

    for (const { host, exit, isCdn } of targets) {
      const inboundTag = isCdn
        ? 'xhttp-cdn'
        : exit
          ? (this.euCascadeOptsFromServer(exit)?.inboundTag ?? 'vless-in')
          : 'vless-in';
      const removed = await this.removeKey(keyId, host, inboundTag);
      if (!removed) return false;
    }

    await manager.update(UserKeyEntity, { id: keyId }, { status: 'expired' });
    return true;
  }

  public async reactivateXrayKey(
    keyId: string,
    manager: EntityManager = this.em,
  ): Promise<boolean> {
    let result = true;
    const keyEntity = await manager.findOne(UserKeyEntity, {
      where: { id: keyId },
      relations: ['user'],
    });

    if (!keyEntity) return false;

    const targets = await this.getKeyTargets(keyEntity, manager);

    for (const { host, exit, isCdn } of targets) {
      const isCreated = await this.createKey(keyEntity, host, exit, isCdn);
      if (!isCreated) result = false;
    }

    return result;
  }

  private euCascadeOptsFromServer(
    eu: ServerEntity,
  ): CreateXrayKeyOptions | null {
    const tag = eu.forCascadeInboundTag?.trim();
    const port = eu.port;
    if (!tag || port == null || port < 1 || port > 65535) return null;
    return { inboundTag: tag, linkPort: port };
  }

  // Признак VIP-сервера (VLESS + XHTTP через Яндекс CDN). Проверяем есть ли значение в поле cdnDomain.
  private isCdnServer(server: ServerEntity): boolean {
    return !!server.cdnDomain;
  }

  public async checkAlmostExpiredKeys() {
    const nowPlusOneDay = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const users = await this.em.find(UserEntity, {
      where: {
        keys: {
          status: 'active',
          expiresAt: LessThanOrEqual(nowPlusOneDay),
        },
        telegramId: Not(IsNull()),
      },
      relations: ['keys'],
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
      relations: ['user', 'cascadeToServer'],
    });

    for (const key of expiredKeys) {
      try {
        // const renewed = await this.telegramService.tryAutoRenewExpiredKey(key);
        // if (renewed) continue;

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

      const used = Number(key.countTrafficUsed);
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

  public async notifyLowTraffic(): Promise<void> {
    const keys = await this.em.find(UserKeyEntity, {
      where: { protocol: 'xray', status: 'active' },
      relations: ['user'],
    });

    for (const key of keys) {
      const limit = key.countTrafficLimit;
      if (!limit || limit <= 0) continue;
      if (!key.user?.telegramId) continue;

      const used = Number(key.countTrafficUsed);
      const left = Math.max(0, Number(limit) - Math.max(0, used));
      const leftRatio = left / Number(limit);

      // threshold: <=10%
      if (leftRatio > 0.1) continue;

      await this.telegramService.sendMessageKeyTrafficLow(key.id);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  // Статистика потребления трафика в формате `1,55 Gb / 5,00 Gb`.
  public getPremiumTrafficProgress(key: UserKeyEntity): string | null {
    if (!key.countTrafficLimit) return null;

    const usedBytes = Number(key.countTrafficUsed);
    const toGb = (bytes: number) =>
      (bytes / 1024 / 1024 / 1024).toFixed(2).replace('.', ',');
    const leftBytes = Math.max(0, Number(key.countTrafficLimit) - usedBytes);
    return `${toGb(usedBytes)} Gb / ${toGb(key.countTrafficLimit)} Gb (осталось ${toGb(leftBytes)} Gb)`;
  }

  public async patchActiveKeysToServer(
    server: ServerEntity,
    manager: EntityManager = this.em,
  ) {
    const isWhite = server.code === 'white';
    const isCdn = this.isCdnServer(server);

    // Активные некаскадные ключи заданного типа тарифа.
    const activeKeysByKind = (kind: 'base' | 'cdn') =>
      manager
        .createQueryBuilder(UserKeyEntity, 'k')
        .innerJoinAndSelect('k.user', 'user')
        .innerJoin('k.tariff', 't')
        .where('k.protocol = :p AND k.status = :st', {
          p: 'xray',
          st: 'active',
        })
        .andWhere('k.cascadeToServerId IS NULL AND t.kind = :kind', { kind })
        .getMany();

    const notFound = () => {
      throw new NotFoundException(`Server ${server.id} not found`);
    };

    // white — входной сервер каскада: восстанавливаем каскадные ключи на выходы.
    if (isWhite) {
      const cascadeKeys = await manager
        .createQueryBuilder(UserKeyEntity, 'k')
        .innerJoinAndSelect('k.user', 'user')
        .where('k.protocol = :p AND k.status = :st', {
          p: 'xray',
          st: 'active',
        })
        .andWhere('k.cascadeToServerId IS NOT NULL')
        .getMany();
      const exits = await this.getCascadeExitServers(manager);
      for (const key of cascadeKeys) {
        for (const exit of exits) {
          if (!(await this.createKey(key, server, exit, false))) notFound();
        }
      }
      return;
    }

    // Совмещённый сервер: восстанавливаем base (reality) и, если есть cdnDomain, VIP (xhttp).
    const baseKeys = await activeKeysByKind('base');
    for (const key of baseKeys) {
      if (!(await this.createKey(key, server, undefined, false))) notFound();
    }

    if (isCdn) {
      const cdnKeys = await activeKeysByKind('cdn');
      for (const key of cdnKeys) {
        if (!(await this.createKey(key, server, undefined, true))) notFound();
      }
    }
  }

  public async createServer(dto: CreateServerDto) {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    const manager = qr.manager;

    try {
      const existing = await manager.findOne(ServerEntity, {
        where: [{ code: dto.code }, { host: dto.host }],
      });
      if (existing)
        throw new ConflictException(
          'Server with this code or host already exists',
        );

      const server = await manager.save(
        manager.create(ServerEntity, {
          host: dto.host,
          code: dto.code,
          canDefaultCreateKey: dto.canDefaultCreateKey ?? false,
          canCreateKey: dto.canCreateKey ?? false,
          port: dto.port ?? null,
          forCascadeInboundTag: dto.forCascadeInboundTag ?? null,
          cdnDomain: dto.cdnDomain ?? null,
        }),
      );

      await this.warmServerParamsCache(server);
      await this.patchActiveKeysToServer(server, manager);

      return server;
    } catch (e) {
      await qr.rollbackTransaction();
      console.error(e);
      return null;
    } finally {
      await qr.release();
    }
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

  private async removeKey(
    id: string,
    server: ServerEntity,
    inboundTag: string,
  ): Promise<boolean> {
    const commands = [
      `xray api rmu --server=127.0.0.1:10085 --tag=${inboundTag} "${id}" 2>/dev/null || true`,
      `rm -f /xray/data/users/${id}-${inboundTag}.json /xray/data/users/${id}.json`,
    ];

    const result = await this.runCommands(server, commands);

    return !!result;
  }

  public async buildSubscriptionUri(
    keyId: string,
    user: UserEntity,
  ): Promise<string | null> {
    const key = await this.em.findOne(UserKeyEntity, { where: { id: keyId } });
    if (!key) return null;

    const targets = await this.getKeyTargets(key);
    const uris: string[] = [];

    for (const { host, exit, isCdn } of targets) {
      // VIP сервера
      if (isCdn) {
        if (!host.cdnDomain) continue;
        const country = host.code.replace(/^vip-/, '');
        const label = `${this.t(user, `${country}_flag`)} ${this.t(user, `${country}_name`)} ${this.t(user, 'vip')}`;
        uris.push(this.buildCdnXhttpUri(keyId, host.cdnDomain, label));
        continue;
      }

      const data = await this.getServerParams(host);
      if (!data) break;

      const [publicKey, sni, defaultPort, shortId] = data.map((v) => v.trim());

      const opts = exit ? this.euCascadeOptsFromServer(exit) : null;
      if (exit && !opts) continue;
      const port = String(opts?.linkPort ?? defaultPort);
      if (!/^\d+$/.test(port)) break;

      const code = exit ? exit.code : host.code;
      const label = `${this.t(user, `${code}_flag`)} ${this.t(user, `${code}_name`)}`;
      const keyName = exit ? `${label} (${this.t(user, 'white_name')})` : label;
      const uri = `vless://${keyId}@${host.host}:${port}?encryption=none&security=reality&sni=${sni}&fp=firefox&pbk=${publicKey}&sid=${shortId}&type=tcp&headerType=none&flow=xtls-rprx-vision#${encodeURIComponent(keyName)}`;
      uris.push(uri);
    }

    return uris.join('\n');
  }

  // Расширенные xhttp-параметры, вередаем query `extra`, так как передаются методом ГЕТ
  // (URL-кодированный JSON). Значения Будут совпадать с теме что записаны в конфиг xray на сервере, в поеле: xhttpSettings
  private static readonly VIP_XHTTP_EXTRA = {
    xPaddingBytes: '100-1000',
    xPaddingObfsMode: true,
    xPaddingKey: 'hash',
    xPaddingHeader: 'X-Client-Version',
    xPaddingPlacement: 'queryInHeader',
    xPaddingMethod: 'tokenish',
    sessionPlacement: 'header',
    sessionKey: 'X-Upload-Token',
    seqPlacement: 'query',
    seqKey: 'chunk_id',
    uplinkHTTPMethod: 'GET',
    scMaxBufferedPosts: 30,
    scStreamUpServerSecs: '20-80',
    enableXmux: true,
    xmux: {
      maxConcurrency: '16-32',
      cMaxReuseTimes: 1000,
      hMaxRequestTimes: '600-900',
      hMaxReusableSecs: '100',
      hKeepAlivePeriod: 20000,
    },
  };

  private buildCdnXhttpUri(
    keyId: string,
    cdnDomain: string,
    label: string,
  ): string {
    const extra = encodeURIComponent(
      JSON.stringify(XrayService.VIP_XHTTP_EXTRA),
    );
    return (
      `vless://${keyId}@${cdnDomain}:443` +
      `?encryption=none&security=tls&sni=${cdnDomain}&host=${cdnDomain}` +
      `&alpn=h2%2Chttp%2F1.1&type=xhttp&path=%2Fpoll&mode=packet-up&fp=chrome&extra=${extra}` +
      `#${encodeURIComponent(label)}`
    );
  }

  private async createKey(
    keyEntity: UserKeyEntity,
    host: ServerEntity,
    exit?: ServerEntity,
    isCdn = false,
  ): Promise<boolean> {
    // VIP (определяет тип тарифа, а не сервер).
    if (isCdn) {
      const inboundTag = 'xhttp-cdn';
      const port = String(host.port ?? '').trim();
      if (!/^\d+$/.test(port)) {
        logger.error(
          `[createKey] VIP ${host.code}: задайте локальный port xhttp-инбаунда`,
        );
        return false;
      }
      const id = keyEntity.id;
      const userFile = `/xray/data/users/${id}-${inboundTag}.json`;
      const commands = [
        `mkdir -p /xray/data/users`,
        `echo '{"inbounds":[{"tag":"${inboundTag}","listen":"0.0.0.0","port":${port},"protocol":"vless","settings":{"clients":[{"id":"${id}","email":"${id}","level":0}],"decryption":"none"}}]}' > ${userFile}`,
        `xray api adu --server=127.0.0.1:10085 ${userFile}`,
      ];
      return !!(await this.runCommands(host, commands));
    }

    let options: CreateXrayKeyOptions | undefined;
    if (exit) {
      const fromEu = this.euCascadeOptsFromServer(exit);
      if (!fromEu) {
        logger.error(
          `[createKey] ключ ${keyEntity.id}: у EU (${exit.code}) задайте forCascadeInboundTag и port`,
        );
        return false;
      }
      options = fromEu;
    }

    const data = await this.fetchServerParams(host);
    if (!data) return false;

    const defaultPort = data.map((v) => v.trim())[2];

    const inboundTag = options?.inboundTag ?? 'vless-in';
    if (!VALID_INBOUND_TAG_RE.test(inboundTag)) {
      logger.error(`[createKey] недопустимый inboundTag "${inboundTag}"`);
      return false;
    }
    const id = keyEntity.id;
    const port = String(options?.linkPort ?? defaultPort).trim();
    if (!/^\d+$/.test(port)) return false;

    const userFile = exit
      ? `/xray/data/users/${id}-${inboundTag}.json`
      : `/xray/data/users/${id}.json`;
    const commands = [
      `mkdir -p /xray/data/users`,
      `echo '{"inbounds":[{"tag":"${inboundTag}","listen":"0.0.0.0","port":${port},"protocol":"vless","settings":{"clients":[{"id":"${id}","email":"${id}","flow":"xtls-rprx-vision","level":0}],"decryption":"none"}}]}' > ${userFile}`,
      `xray api adu --server=127.0.0.1:10085 ${userFile}`,
    ];
    const result = await this.runCommands(host, commands);

    return !!result;
  }

  private async runCommands(
    server: ServerEntity,
    commands: string[],
  ): Promise<string[] | null> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 8000);
    const res = await fetch(`http://${server.host}:440/commands`, {
      method: 'POST',
      body: JSON.stringify({ commands }),
      headers: { 'Content-Type': 'application/json' },
      signal: abort.signal,
    })
      .catch((e: Error) => {
        logger.error(`[runCommands] ${server.code} error: ${e.message}`);
        return null;
      })
      .finally(() => clearTimeout(timer));

    if (!res) return null;
    if (![200, 201].includes(res.status)) {
      logger.error(await res.json());
      return null;
    }
    return (await res.json()) as string[];
  }

  private async getCascadeExitServers(
    manager: EntityManager = this.em,
  ): Promise<ServerEntity[]> {
    const servers = await manager.find(ServerEntity, {
      where: { canCreateKey: true, code: Not('white') },
    });
    return servers.filter((s) => this.euCascadeOptsFromServer(s) !== null);
  }

  // `host` = white (входной сервер), `exit` = (европейский сервер). Для обычного ключа, все что white серверы.
  private async getKeyTargets(
    key: UserKeyEntity,
    manager: EntityManager = this.em,
  ): Promise<{ host: ServerEntity; exit?: ServerEntity; isCdn?: boolean }[]> {
    // CDN тариф: ключ только на VIP/CDN серверы, без каскадных выходов.
    const tariff = await manager.findOne(TariffEntity, {
      where: { id: key.tariffId },
    });
    if (tariff?.kind === 'cdn') {
      const vipHosts = await manager.find(ServerEntity, {
        where: { canCreateKey: true, cdnDomain: Not(IsNull()) },
      });
      return vipHosts.map((host) => ({ host, isCdn: true }));
    }

    if (key.cascadeToServerId) {
      const whites = await manager.find(ServerEntity, {
        where: { canCreateKey: true, code: 'white' },
      });
      const exits = await this.getCascadeExitServers(manager);
      return whites.flatMap((host) => exits.map((exit) => ({ host, exit })));
    }

    const hosts = await manager.find(ServerEntity, {
      where: { canCreateKey: true, code: Not('white') },
    });
    return hosts.map((host) => ({ host }));
  }

  private t(ctx: UserEntity | string, key: string) {
    let lang = 'en';

    if (typeof ctx === 'string') lang = ctx;
    else if (ctx.languageCode) lang = ctx.languageCode;

    return this.i18nService.t(lang, key);
  }
}
