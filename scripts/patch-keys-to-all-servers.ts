/**
 * Скрипт для патча существующих активных ключей:
 * регистрирует UUID каждого не-cascade ключа на всех серверах с canDefaultCreateKey=true.
 *
 * Запуск:
 *   npx ts-node scripts/patch-keys-to-all-servers.ts
 *
 * Скрипт идемпотентен — повторный запуск безопасен (xray api adu перезаписывает если уже есть).
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { UserKeyEntity } from '../src/modules/database/entities/user-key.entity';
import { ServerEntity } from '../src/modules/database/entities/server.entity';

const dataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [UserKeyEntity, ServerEntity],
  synchronize: false,
});

async function registerOnServer(
  server: ServerEntity,
  keyId: string,
): Promise<boolean> {
  const commands = [
    'cat /xray/data/server.port',
    `mkdir -p /xray/data/users`,
    `echo '{"inbounds":[{"tag":"vless-in","listen":"0.0.0.0","port":PORT_PLACEHOLDER,"protocol":"vless","settings":{"clients":[{"id":"${keyId}","email":"${keyId}","flow":"xtls-rprx-vision","level":0}],"decryption":"none"}}]}' > /xray/data/users/${keyId}.json`,
    `xray api adu --server=127.0.0.1:10085 /xray/data/users/${keyId}.json`,
  ];

  // Получаем порт и регистрируем
  const portRes = await fetch(`http://${server.host}:440/commands`, {
    method: 'POST',
    body: JSON.stringify({ commands: ['cat /xray/data/server.port'] }),
    headers: { 'Content-Type': 'application/json' },
  }).catch(() => null);

  if (!portRes?.ok) return false;
  const [port] = (await portRes.json()) as string[];
  const defaultPort = port.trim();
  if (!/^\d+$/.test(defaultPort)) return false;

  const regRes = await fetch(`http://${server.host}:440/commands`, {
    method: 'POST',
    body: JSON.stringify({
      commands: [
        `mkdir -p /xray/data/users`,
        `echo '{"inbounds":[{"tag":"vless-in","listen":"0.0.0.0","port":${defaultPort},"protocol":"vless","settings":{"clients":[{"id":"${keyId}","email":"${keyId}","flow":"xtls-rprx-vision","level":0}],"decryption":"none"}}]}' > /xray/data/users/${keyId}.json`,
        `xray api adu --server=127.0.0.1:10085 /xray/data/users/${keyId}.json`,
      ],
    }),
    headers: { 'Content-Type': 'application/json' },
  }).catch(() => null);

  return !!regRes?.ok;
}

async function main() {
  await dataSource.initialize();
  console.log('DB connected');

  const keys = await dataSource.manager.find(UserKeyEntity, {
    where: { protocol: 'xray', status: 'active' },
  });
  const nonCascadeKeys = keys.filter((k) => !k.cascadeToServerId);

  const servers = await dataSource.manager.find(ServerEntity, {
    where: { canDefaultCreateKey: true },
  });

  console.log(
    `Ключей для патча: ${nonCascadeKeys.length}, серверов: ${servers.length}`,
  );

  let ok = 0;
  let fail = 0;

  for (const key of nonCascadeKeys) {
    const results = await Promise.allSettled(
      servers.map((s) => registerOnServer(s, key.id)),
    );
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled' && r.value) {
        ok++;
        console.log(`✅ key ${key.id.slice(0, 8)} → server ${servers[i].code}`);
      } else {
        fail++;
        console.log(`❌ key ${key.id.slice(0, 8)} → server ${servers[i].code}`);
      }
    }
  }

  console.log(`\nГотово. Успешно: ${ok}, ошибок: ${fail}`);
  await dataSource.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
