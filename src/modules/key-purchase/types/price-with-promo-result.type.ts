import { PromoCodeEntity } from '../../database/entities/promo-code.entity';

export type PriceWithPromoResult = {
  originalPrice: number;
  finalPrice: number;
  appliedPromo: PromoCodeEntity;
};
