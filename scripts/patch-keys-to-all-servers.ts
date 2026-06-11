/**
 * Скрипт для патча существующих активных ключей:
 * Запуск: npm run patch:keys
 */

import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'path';
import { DataSource } from 'typeorm';
import { UserKeyEntity } from '../src/modules/database/entities/user-key.entity';
import { ServerEntity } from '../src/modules/database/entities/server.entity';

config({ path: resolve(__dirname, '../.env') });

function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const { PG_HOST, PG_PORT, PG_DATABASE, PG_USERNAME, PG_PASSWORD } =
    process.env;
  if (!PG_HOST || !PG_DATABASE || !PG_USERNAME) {
    throw new Error(
      'незаданы DATABASE_URL или PG_HOST, PG_DATABASE, PG_USERNAME, PG_PASSWORD',
    );
  }

  const port = PG_PORT ?? '5459';
  const password = encodeURIComponent(PG_PASSWORD ?? 'secrets');
  return `postgresql://${PG_USERNAME}:${password}@${PG_HOST}:${port}/${PG_DATABASE}`;
}

const dataSource = new DataSource({
  type: 'postgres',
  url: getDatabaseUrl(),
  entities: [resolve(__dirname, '../src/modules/database/entities/*.entity.{ts,js}')],
  synchronize: false,
});

const FETCH_TIMEOUT_MS = 60_000; // 1 минута

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: abort.signal })
    .catch(() => null)
    .finally(() => clearTimeout(timer));
}

async function registerOnServer(
  server: ServerEntity,
  keyId: string,
): Promise<boolean> {
  const portRes = await fetchWithTimeout(`http://${server.host}:440/commands`, {
    method: 'POST',
    body: JSON.stringify({ commands: ['cat /xray/data/server.port'] }),
    headers: { 'Content-Type': 'application/json' },
  });

  if (!portRes?.ok) return false;
  const [port] = (await portRes.json()) as string[];
  const defaultPort = port.trim();
  if (!/^\d+$/.test(defaultPort)) return false;

  const regRes = await fetchWithTimeout(`http://${server.host}:440/commands`, {
    method: 'POST',
    body: JSON.stringify({
      commands: [
        `mkdir -p /xray/data/users`,
        `echo '{"inbounds":[{"tag":"vless-in","listen":"0.0.0.0","port":${defaultPort},"protocol":"vless","settings":{"clients":[{"id":"${keyId}","email":"${keyId}","flow":"xtls-rprx-vision","level":0}],"decryption":"none"}}]}' > /xray/data/users/${keyId}.json`,
        `xray api adu --server=127.0.0.1:10085 /xray/data/users/${keyId}.json`,
      ],
    }),
    headers: { 'Content-Type': 'application/json' },
  });

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
