import { forwardRef, Inject, Injectable } from '@nestjs/common';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { EntityManager, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { ServerEntity } from '../database/entities/server.entity';

import { UserKeyEntity } from '../database/entities/user-key.entity';
import { NodeSSH } from 'node-ssh';
import { TelegramService } from '../telegram/telegram-service';
import { UserEntity } from '../database/entities/user.entity';
import { I18nService } from '../i18n/i18n.service';
import { Context } from 'telegraf';

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

      const ssh = new NodeSSH();
      await ssh.connect({
        host: server.host,
        username: server.username,
        password: server.password,
      });

      const uuid = crypto.randomUUID();
      const xrayKeys = await this.readXrayKeys(ssh);
      if (!xrayKeys) {
        ssh.dispose();
        return;
      }

      const key = this.exportVpnKey(
        uuid,
        server,
        xrayKeys.publicKey,
        xrayKeys.shortId,
        user.languageCode,
      );

      const userKeyEntity = {
        id: uuid,
        userId: user.id,
        serverId: server.id,
        key,
        protocol: 'xray',
        tariffId,
        expiresAt: new Date(),
      } as UserKeyEntity;

      const added = await this.addXrayClient(ssh, server, uuid);
      if (!added) return;

      ssh.dispose();

      return userKeyEntity;
    } catch (error) {
      console.error(error);
      return undefined;
    }
  }

  public async deleteXrayKey(keyEntity: UserKeyEntity) {
    const keyId = keyEntity.id;
    const server = keyEntity.server;

    const removed = await this.removeXrayClientFromServer(server, keyId);
    if (!removed) return;

    await this.em.update(UserKeyEntity, { id: keyId }, { status: 'expired' });
    return true;
  }

  // повторно включает Xray-ключ на сервере (для продления), без изменения URI
  public async reactivateXrayKey(keyId: string): Promise<boolean> {
    const keyEntity = await this.em.findOne(UserKeyEntity, {
      where: { id: keyId },
      relations: ['server'],
    });
    if (!keyEntity || !keyEntity.server) return false;
    const server = keyEntity.server;

    const ssh = new NodeSSH();
    await ssh.connect({
      host: server.host,
      username: server.username,
      password: server.password,
    });

    const added = await this.addXrayClient(ssh, server, keyId);
    ssh.dispose();

    return added;
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

    const ssh = new NodeSSH();
    await ssh.connect({
      host: newServer.host,
      username: newServer.username,
      password: newServer.password,
    });

    const xrayKeys = await this.readXrayKeys(ssh);
    if (!xrayKeys) {
      ssh.dispose();
      return null;
    }

    const newKey = this.exportVpnKey(
      keyId,
      newServer,
      xrayKeys.publicKey,
      xrayKeys.shortId,
      keyEntity.user.languageCode,
    );

    const added = await this.addXrayClient(ssh, newServer, keyId);
    ssh.dispose();

    if (!added) return null;

    await this.em.update(
      UserKeyEntity,
      {
        id: keyId,
      },
      {
        serverId: newServer.id,
        key: newKey,
      },
    );

    const checkAndDeleteKey = async () => {
      const userKey = await this.em.findOne(UserKeyEntity, {
        where: { id: keyId, serverId: oldServer.id },
      });

      if (!userKey) await this.removeXrayClientFromServer(oldServer, keyId);
    };

    setTimeout(() => {
      checkAndDeleteKey();
    }, 60 * 1000);

    return newKey;
  }

  private async addXrayClient(
    ssh: NodeSSH,
    server: ServerEntity,
    clientId: string,
  ): Promise<boolean> {
    const userConfig = {
      inbounds: [
        {
          tag: 'vless-in',
          port: server.xRayPort,
          protocol: 'vless',
          settings: {
            clients: [
              {
                id: clientId,
                email: clientId,
                flow: 'xtls-rprx-vision',
              },
            ],
            decryption: 'none',
          },
        },
      ],
    };

    const userConfigString = JSON.stringify(userConfig, null, 2).replace(
      /'/g,
      "'\\''",
    );

    const addResult = await ssh.execCommand(`
      echo '${userConfigString}' | \
      docker exec -i amnezia-xray sh -c 'cat > /opt/amnezia/xray/user-${clientId}.json' && \
      docker exec amnezia-xray xray api adu --server=127.0.0.1:10085 /opt/amnezia/xray/user-${clientId}.json && \
      docker exec amnezia-xray rm -f /opt/amnezia/xray/user-${clientId}.json
    `);

    if (addResult.stderr) {
      console.error('[AmneziaService] addXrayClient adu error:', addResult);
      return false;
    }

    return true;
  }

  private async removeXrayClientFromServer(
    server: ServerEntity,
    clientId: string,
  ): Promise<boolean> {
    const ssh = new NodeSSH();
    await ssh.connect({
      host: server.host,
      username: server.username,
      password: server.password,
    });

    const removeResult = await ssh.execCommand(
      `docker exec amnezia-xray xray api rmu --server=127.0.0.1:10085 -tag="vless-in" "${clientId}"`,
    );
    if (removeResult.stderr) {
      console.error(
        '[AmneziaService] removeXrayClientFromServer rmu error:',
        removeResult,
      );
      ssh.dispose();
      return false;
    }

    ssh.dispose();
    return true;
  }

  private async readXrayKeys(
    ssh: NodeSSH,
  ): Promise<{ publicKey: string; shortId: string } | null> {
    const [pubKeyResult, shortIdResult] = await Promise.all([
      ssh.execCommand(
        'docker exec amnezia-xray cat /opt/amnezia/xray/xray_public.key',
      ),
      ssh.execCommand(
        'docker exec amnezia-xray cat /opt/amnezia/xray/xray_short_id.key',
      ),
    ]);

    if (pubKeyResult.stderr || shortIdResult.stderr) {
      console.error(
        '[AmneziaService] readXrayKeys error:',
        pubKeyResult,
        shortIdResult,
      );
      return null;
    }

    return {
      publicKey: pubKeyResult.stdout.trim(),
      shortId: shortIdResult.stdout.trim(),
    };
  }

  private exportVpnKey(
    uuid: string,
    server: ServerEntity,
    xrayPublicKey: string,
    xrayShortId: string,
    language_code?: string,
  ) {
    const config = fs.readFileSync('key.config', { encoding: 'utf8' });
    const key = config
      .replaceAll(
        'DESCRIPTION',
        `${this.t(language_code, `${server.code}_flag`)} ${this.t(language_code, `${server.code}_name`)} (${new Date().toLocaleDateString(
          'ru-RU',
          {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          },
        )})`,
      )
      .replaceAll('UUID', uuid)
      .replaceAll('HOST_NAME', server.host)
      .replaceAll('HOST_NAME', server.host)
      .replaceAll('PORT', server.xRayPort)
      .replaceAll('SERVER_NAME', server.xRayServername)
      .replaceAll('PUBLIC_KEY', xrayPublicKey)
      .replaceAll('SHORT_ID', xrayShortId);

    const jsonBuffer = Buffer.from(key);
    const compressed = zlib.deflateSync(jsonBuffer);
    const sizeBuffer = Buffer.alloc(4);

    sizeBuffer.writeUInt32BE(jsonBuffer.length, 0);
    const finalBuffer = Buffer.concat([sizeBuffer, compressed]);
    const base64url = finalBuffer
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    return 'vpn://' + base64url;
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
          tariff: { expirationDays: MoreThanOrEqual(30) },
        },
      },
      relations: ['keys', 'keys.tariff'],
    });

    await Promise.all(
      users.map((user) => this.telegramService.sendAlmostExpiredKey(user)),
    );
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

  private t(ctx: Context | string | undefined, key: string) {
    return this.i18nService.t(
      typeof ctx === 'string' ? ctx : ctx?.from?.language_code,
      key,
    );
  }
}
