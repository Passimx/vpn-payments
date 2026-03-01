import { forwardRef, Inject, Injectable } from '@nestjs/common';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { EntityManager, LessThanOrEqual } from 'typeorm';
import { ServerEntity } from '../database/entities/server.entity';

import { UserKeyEntity } from '../database/entities/user-key.entity';
import { NodeSSH } from 'node-ssh';
import { TelegramService } from '../telegram/telegram-service';
import { UserEntity } from '../database/entities/user.entity';

@Injectable()
export class AmneziaService {
  constructor(
    private readonly em: EntityManager,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
  ) {}

  public async createXrayKey(userId: string, tariffId: string) {
    try {
      const server = await this.getServer();
      if (!server) return;
      const uuid = crypto.randomUUID();

      const ssh = new NodeSSH();
      await ssh.connect({
        host: server.host,
        username: server.username,
        password: server.password,
      });

      const [pubKeyResult, shortIdResult] = await Promise.all([
        ssh.execCommand(
          'docker exec amnezia-xray cat /opt/amnezia/xray/xray_public.key',
        ),
        ssh.execCommand(
          'docker exec amnezia-xray cat /opt/amnezia/xray/xray_short_id.key',
        ),
      ]);

      if (pubKeyResult.stderr || shortIdResult.stderr) {
        ssh.dispose();
        return;
      }

      const xrayPublicKey = pubKeyResult.stdout.trim();
      const xrayShortId = shortIdResult.stdout.trim();

      const key = this.exportVpnKey(uuid, server, xrayPublicKey, xrayShortId);

      const userKeyEntity = {
        id: uuid,
        userId,
        serverId: server.id,
        key,
        protocol: 'xray',
        tariffId,
        expiresAt: new Date(),
      } as UserKeyEntity;

      // добавляем пользователя через API контейнера, без перезапуска
      const added = await this.addXrayClient(ssh, server, uuid);
      if (!added) return;

      ssh.dispose();

      return userKeyEntity;
    } catch (error) {
      console.error(error);
      return undefined;
    }
  }

  public async deleteXrayKey(keyId: string) {
    const keyEntity = await this.em.findOne(UserKeyEntity, {
      where: { id: keyId },
      relations: ['server'],
    });
    if (!keyEntity) return;
    const server = keyEntity.server;

    const ssh = new NodeSSH();
    await ssh.connect({
      host: server.host,
      username: server.username,
      password: server.password,
    });

    // удаляем пользователя через апишку контенера, без перезапуска контейнера
    const removeResult = await ssh.execCommand(
      `docker exec amnezia-xray xray api rmu --server=127.0.0.1:10085 -tag="vless-in" "${keyId}"`,
    );
    if (removeResult.stderr) {
      console.error('[AmneziaService] deleteXrayKey rmu error:', removeResult);
      ssh.dispose();
      return;
    }

    ssh.dispose();

    // помечаем ключ как истёкший, но не удаляем запись
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

  private exportVpnKey(
    uuid: string,
    server: ServerEntity,
    xrayPublicKey: string,
    xrayShortId: string,
  ) {
    let key = fs.readFileSync('key.config', { encoding: 'utf8' });
    key = key.replace('UUID', uuid);
    key = key.replaceAll('HOST_NAME', server.host);
    key = key.replaceAll('PORT', server.xRayPort);
    key = key.replaceAll('SERVER_NAME', server.xRayServername);
    key = key.replaceAll('PUBLIC_KEY', xrayPublicKey);
    key = key.replaceAll('SHORT_ID', xrayShortId);

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
      .addSelect('COUNT(keys.id)', 'count')
      .leftJoin('servers.keys', 'keys')
      .groupBy('servers.id')
      .orderBy('count', 'ASC')
      .getOne();

    return this.em.findOne(ServerEntity, {
      where: { id: server?.id },
    });
  }

  public async checkAlmostExpiredKeys() {
    const nowPlusOneDay = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const users = await this.em.find(UserEntity, {
      relations: ['keys'],
      where: {
        keys: { status: 'active', expiresAt: LessThanOrEqual(nowPlusOneDay) },
      },
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
    });

    for (const key of expiredKeys) {
      try {
        await this.deleteXrayKey(key.id);
      } catch (e) {
        console.error(
          '[AmneziaService] checkExpiredKeys error for key',
          key.id,
          e,
        );
      }
    }
  }
}
