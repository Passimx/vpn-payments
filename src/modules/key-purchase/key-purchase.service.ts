import { Injectable } from '@nestjs/common';
import crypto from 'node:crypto';
import { DataSource } from 'typeorm';
import { UserEntity } from '../database/entities/user.entity';
import { TariffEntity } from '../database/entities/tariff.entity';
import { PaymentsEntity } from '../database/entities/balance-debit.entity';
import { PromoCodeEntity } from '../database/entities/promo-code.entity';
import { PromoUsageEntity } from '../database/entities/promo-usage.entity';
import { UserKeyEntity } from '../database/entities/user-key.entity';
import { BlitzService } from '../blitz/blitz.service';
import { AmneziaService } from '../amnezia/amnezia-service';

export type PurchaseResult =
  | { ok: true; uri: string; keyId: string }
  | { ok: false; error: string };

export type RenewKeyResult =
  | { ok: true; keyId: string }
  | { ok: false; error: string };

export type PriceWithPromoResult =
  | {
      ok: true;
      originalPrice: number;
      finalPrice: number;
      appliedPromo: PromoCodeEntity;
    }
  | { ok: false; error: string };

@Injectable()
export class KeyPurchaseService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly blitzService: BlitzService,
    private readonly amneziaService: AmneziaService,
  ) {}

  async purchase(
    userId: string,
    tariffId: string,
    promoCode?: string,
    protocol: 'xray' | 'hysteria' = 'xray',
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
        const priceResult = await this.getPriceWithPromo(
          user.id,
          tariff.id,
          promoCode,
        );
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

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + tariff.expirationDays);

      let createdKeyId: string;
      let vpnUri: string;

      if (protocol === 'xray') {
        const amKey = await this.amneziaService.createXrayKey(
          user.id,
          tariff.id,
        );
        if (!amKey) {
          return {
            ok: false,
            error: 'Ошибка создания Xray-ключа. Попробуйте позже.',
          };
        }

        createdKeyId = amKey.id;
        vpnUri = amKey.key;

        await qr.manager.insert(UserKeyEntity, {
          id: createdKeyId,
          key: vpnUri,
          protocol: 'xray',
          userId: user.id,
          serverId: amKey.serverId,
          tariffId: tariff.id,
          expirationDays: tariff.expirationDays,
          expiresAt,
          status: 'active',
          vpnUsername: amKey.id,
        });
      } else {
        const username = crypto.randomUUID().replace(/-/g, '');

        const createResult = await this.blitzService.createUserKey({
          username,
          expirationDays: tariff.expirationDays,
          isUnlimited: tariff.isUnlimited || tariff.trafficGb === 0,
          note: user.id,
        });

        if (!createResult.success) {
          return {
            ok: false,
            error: `Ошибка создания Hysteria-ключа: ${createResult.error ?? 'Неизвестная ошибка'}`,
          };
        }

        const uriResult = await this.blitzService.getUserKeyUri(username);
        if (!uriResult.success || !uriResult.uri) {
          return {
            ok: false,
            error: `Ошибка получения ссылки Hysteria-ключа: ${uriResult.error ?? 'URI не получен'}`,
          };
        }

        vpnUri = uriResult.uri;
        createdKeyId = crypto.randomUUID().replace(/-/g, '');

        await qr.manager.insert(UserKeyEntity, {
          id: createdKeyId,
          key: vpnUri,
          protocol: 'hysteria',
          userId: user.id,
          serverId: null,
          tariffId: tariff.id,
          expirationDays: tariff.expirationDays,
          expiresAt,
          status: 'active',
          vpnUsername: username,
        });
      }

      await qr.manager.insert(PaymentsEntity, {
        userId: user.id,
        amount: finalPrice,
        tariffId: tariff.id,
        vpnKeyId: createdKeyId,
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
        uri: vpnUri,
        keyId: createdKeyId,
      };
    } catch (e) {
      await qr.rollbackTransaction();
      const msg = e instanceof Error ? e.message : 'Unknown error';
      console.error(
        '[KeyPurchase] purchase: unexpected error',
        msg,
        e instanceof Error ? e.stack : undefined,
      );
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

  async renewKey(
    userId: string,
    keyId: string,
    promoCode?: string,
  ): Promise<RenewKeyResult> {
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

      const vpnKey = await qr.manager.findOne(UserKeyEntity, {
        where: { id: keyId, userId: user.id },
        relations: ['tariff'],
      });
      if (!vpnKey) {
        return { ok: false, error: 'Ключ не найден' };
      }

      if (!vpnKey.tariffId || !vpnKey.tariff) {
        return { ok: false, error: 'Тариф для ключа не найден' };
      }

      const tariff = vpnKey.tariff;
      let finalPrice = Number(tariff.price);
      let appliedPromo: PromoCodeEntity | null = null;

      if (promoCode) {
        const priceResult = await this.getPriceWithPromo(
          user.id,
          tariff.id,
          promoCode,
        );
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

      const editResult = await this.blitzService.editUser({
        username: vpnKey.vpnUsername,
        expirationDays: tariff.expirationDays,
        renewCreationDate: true,
      });

      if (!editResult.success) {
        return {
          ok: false,
          error: `Ошибка продления ключа: ${editResult.error}`,
        };
      }

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + tariff.expirationDays);

      await qr.manager
        .createQueryBuilder()
        .update(UserKeyEntity)
        .set({
          expiresAt,
          expirationDays: tariff.expirationDays,
          status: 'active' as const,
        })
        .where('id = :id', { id: vpnKey.id })
        .execute();

      await qr.manager.insert(PaymentsEntity, {
        userId: user.id,
        amount: finalPrice,
        tariffId: tariff.id,
        vpnKeyId: vpnKey.id,
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
        keyId: vpnKey.id,
      };
    } catch (e) {
      await qr.rollbackTransaction();
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return { ok: false, error: `Ошибка: ${msg}` };
    } finally {
      await qr.release();
    }
  }
}
