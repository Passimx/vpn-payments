import { PromoCodeEntity } from '../../database/entities/promo-code.entity';

export type PriceWithPromoResult =
  | {
      ok: true;
      originalPrice: number;
      finalPrice: number;
      appliedPromo: PromoCodeEntity;
    }
  | { ok: false; error: string };
