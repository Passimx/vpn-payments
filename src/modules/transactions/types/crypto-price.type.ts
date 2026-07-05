import { PriceType } from './price.type';

export type CryptoPriceType = Record<keyof PriceType, PriceType>;
