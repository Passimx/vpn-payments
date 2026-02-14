import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserEntity } from '../database/entities/user.entity';
import { TariffEntity } from '../database/entities/tariff.entity';
import { VpnKeyEntity } from '../database/entities/vpn-key.entity';
import { PaymentsEntity } from '../database/entities/balance-debit.entity';
import { PromoCodeEntity } from '../database/entities/promo-code.entity';
import { PromoUsageEntity } from '../database/entities/promo-usage.entity';
import { BlitzService } from '../blitz/blitz.service';

export type PurchaseResult =
  | { ok: true; uri: string; keyId: string }
  | { ok: false; error: string };

export type PriceWithPromoResult =
  | { ok: true; originalPrice: number; finalPrice: number; appliedPromo: PromoCodeEntity }
  | { ok: false; error: string };

@Injectable()
export class KeyPurchaseService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly blitzService: BlitzService,
  ) {}

  async purchase(
    userId: string,
    tariffId: string,
    promoCode?: string,
  ): Promise<PurchaseResult> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      const user = await qr.manager.findOne(UserEntity, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) {
        return { ok: false, error: 'Пользователь не найден' };
      }

      const tariff = await qr.manager.findOne(TariffEntity, {
        where: { id: tariffId, active: true },
      });
      if (!tariff) {
        return { ok: false, error: 'Тариф не найден' };
      }

      let finalPrice = Number(tariff.price);
      let appliedPromo: PromoCodeEntity | null = null;

      if (promoCode) {
        const priceResult = await this.getPriceWithPromo(user.id, tariff.id, promoCode);
        if (!priceResult.ok) return priceResult;
        finalPrice = priceResult.finalPrice;
        appliedPromo = priceResult.appliedPromo;
      }

      const balance = Number(user.balance);
      if (balance < finalPrice) {
        return {
          ok: false,
          error: `Недостаточно средств. Баланс: ${balance} руб.`,
        };
      }

      const isConnected = await this.blitzService.checkConnection();
      if (!isConnected) {
        return {
          ok: false,
          error: 'Сервис временно недоступен. Попробуйте позже.',
        };
      }

      const vpnUsername = `${userId}_${Date.now()}`;
      const createResult = await this.blitzService.createUserKey({
        username: vpnUsername,
        trafficLimitGb: tariff.trafficGb,
        expirationDays: tariff.expirationDays,
        isUnlimited: tariff.isUnlimited || tariff.trafficGb === 0,
        note: `userId:${userId}`,
      });

      if (!createResult.success) {
        return {
          ok: false,
          error: `Ошибка создания ключа: ${createResult.error}`,
        };
      }

      const uriResult = await this.blitzService.getUserKeyUri(vpnUsername);
      if (!uriResult.success || !uriResult.uri) {
        return {
          ok: false,
          error: `Не удалось получить ключ: ${uriResult.error ?? 'нет URI'}`,
        };
      }

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + tariff.expirationDays);

      const vpnKey = qr.manager.create(VpnKeyEntity, {
        userId: user.id,
        vpnUsername,
        vpnUri: uriResult.normalSub ?? uriResult.uri ?? null,
        trafficLimitGb: tariff.trafficGb,
        expirationDays: tariff.expirationDays,
        expiresAt,
        status: 'active' as const,
        tariffId: tariff.id,
      });
      const savedKey = await qr.manager.save(VpnKeyEntity, vpnKey);

      await qr.manager.insert(PaymentsEntity, {
        userId: user.id,
        amount: finalPrice,
        tariffId: tariff.id,
        vpnKeyId: savedKey.id,
      });

      if (finalPrice > 0) {
        const priceRounded = Math.round(finalPrice);
        await qr.manager
          .createQueryBuilder()
          .update(UserEntity)
          .set({ balance: () => `balance - ${priceRounded}` })
          .where('id = :id', { id: user.id })
          .execute();
      }

      if (appliedPromo) {
        await qr.manager.insert(PromoUsageEntity, {
          userId: user.id,
          promoCodeId: appliedPromo.id,
        });
      }

      await qr.commitTransaction();
      return {
        ok: true,
        uri: uriResult.normalSub ?? uriResult.uri,
        keyId: savedKey.id,
      };
    } catch (e) {
      await qr.rollbackTransaction();
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return { ok: false, error: `Ошибка: ${msg}` };
    } finally {
      await qr.release();
    }
  }

  async getPriceWithPromo(
    userId: string,
    tariffId: string,
    promoCode: string,
  ): Promise<PriceWithPromoResult> {
    const manager = this.dataSource.manager;

    const tariff = await manager.findOne(TariffEntity, {
      where: { id: tariffId, active: true },
    });
    if (!tariff) {
      return { ok: false, error: 'Тариф не найден' };
    }

    const promo = await manager.findOne(PromoCodeEntity, {
      where: { code: promoCode, active: true },
    });
    if (!promo) {
      return { ok: false, error: 'Промокод не найден или не активен' };
    }

    const existingUsage = await manager.findOne(PromoUsageEntity, {
      where: {
        userId,
        promoCodeId: promo.id,
      },
    });
    if (existingUsage) {
      return { ok: false, error: 'Этот промокод уже был использован' };
    }

    const originalPrice = Number(tariff.price);
    let finalPrice = originalPrice;
    if (promo.isFreeKey) {
      finalPrice = 0;
    } else if (promo.discountPercent > 0) {
      const discount = (originalPrice * promo.discountPercent) / 100;
      finalPrice = Math.max(0, Math.round(originalPrice - discount));
    }

    return {
      ok: true,
      originalPrice,
      finalPrice,
      appliedPromo: promo,
    };
  }
}

