import * as process from 'process';
import { config } from 'dotenv';

config();

export const Envs = {
  database: {
    host: process.env.PG_HOST,
    port: Number(process.env.PG_PORT),
    database: process.env.PG_DATABASE,
    username: process.env.PG_USERNAME,
    password: process.env.PG_PASSWORD,
  },
  telegram: {
    botToken: String(process.env.TELEGRAM_BOT_TOKEN),
  },
  tBank: {},
  ton: {
    walletAddress: String(process.env.TON_WALLET_ADDRESS),
    endpointUrl: String(process.env.TON_ENDPOINT_URL),
    endpointApiKey: String(process.env.TON_ENDPOINT_TON_APIKEY),
  },
  blitz: {
    apiUrl: String(process.env.BLITZ_API_URL),
    apiKey: String(process.env.BLITZ_API_KEY),
  },
  yoomoney: {
    walletNumber: String(process.env.YOOMONEY_WALLET_NUMBER || '4100119473106556'),
    accessToken: process.env.YOOMONEY_ACCESS_TOKEN || '',
  },
};
