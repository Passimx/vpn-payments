import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { EntityManager } from 'typeorm';
import { ServerEntity } from '../database/entities/server.entity';

import { UserKeyEntity } from '../database/entities/user-key.entity';
import { NodeSSH } from 'node-ssh';
import { XrayServerConfigType } from './types/xray-server-config.type';

@Injectable()
export class AmneziaService {
  constructor(private readonly em: EntityManager) {}

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

      const [result1, result2, result3] = await Promise.all([
        ssh.execCommand(
          'docker exec amnezia-xray cat /opt/amnezia/xray/server.json',
        ),
        ssh.execCommand(
          'docker exec amnezia-xray cat /opt/amnezia/xray/xray_public.key',
        ),
        ssh.execCommand(
          'docker exec amnezia-xray cat /opt/amnezia/xray/xray_short_id.key',
        ),
      ]);

      if (result1.stderr || result2.stderr || result3.stderr) return;

      const config = JSON.parse(result1.stdout) as XrayServerConfigType;
      const xrayPublicKey = result2.stdout;
      const xrayShortId = result3.stdout;

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

      config.inbounds[0].settings.clients.push({
        id: uuid,
        email: uuid,
        flow: 'xtls-rprx-vision',
      } as never);
      const configString = JSON.stringify(config, null, 2).replace(
        /'/g,
        "'\\''",
      );

      await ssh.execCommand(`
      echo '${configString}' | \
      docker exec -i amnezia-xray sh -c 'cat > /opt/amnezia/xray/server.json'
    `);
      await ssh.execCommand('docker restart amnezia-xray');
      ssh.dispose();

      await this.em.insert(UserKeyEntity, userKeyEntity);
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
    const result = await ssh.execCommand(
      'docker exec amnezia-xray cat /opt/amnezia/xray/server.json',
    );

    if (result.stderr) return;

    const config = JSON.parse(result.stdout) as XrayServerConfigType;
    config.inbounds[0].settings.clients =
      config.inbounds[0].settings.clients.filter(({ id }) => id !== keyId);
    const configString = JSON.stringify(config, null, 2).replace(/'/g, "'\\''");

    await ssh.execCommand(`
      echo '${configString}' | \
      docker exec -i amnezia-xray sh -c 'cat > /opt/amnezia/xray/server.json'
    `);
    await ssh.execCommand('docker restart amnezia-xray');
    ssh.dispose();

    await this.em.delete(UserKeyEntity, { id: keyId });
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
}
