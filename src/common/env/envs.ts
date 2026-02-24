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
  crypto: {
    ethereum: {
      walletAddress: '0x6651D1aF77B4997EDA6A9233613e1CAcC7E657BF',
      jettonWalletAddress: '0x6651D1aF77B4997EDA6A9233613e1CAcC7E657BF',
    },
    tron: {},
    solana: {},
    bsc: {},
    bitcoin: {},
    ton: {
      walletAddress: String(process.env.TON_WALLET_ADDRESS),
      jettonWalletAddress: String(process.env.TON_JETTON_WALLET_ADDRESS),
      endpointUrl: String(process.env.TON_ENDPOINT_URL),
      endpointApiKey: String(process.env.TON_ENDPOINT_TON_APIKEY),
    },
    allowance: 0.5,
  },
  blitz: {
    apiUrl: String(process.env.BLITZ_API_URL),
    apiKey: String(process.env.BLITZ_API_KEY),
  },
  yookassa: {
    walletNumber: String(process.env.YOOKASSA_WALLET_NUMBER),
    accessToken: process.env.YOOKASSA_ACCESS_TOKEN,
  },
};
