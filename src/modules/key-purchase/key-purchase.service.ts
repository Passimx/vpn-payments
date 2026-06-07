import { Injectable } from '@nestjs/common';
import crypto from 'node:crypto';
import { DataSource } from 'typeorm';
import { UserEntity } from '../database/entities/user.entity';
import { TariffEntity } from '../database/entities/tariff.entity';
import { PaymentsEntity } from '../database/entities/payment.entity';
import { PromoCodeEntity } from '../database/entities/promo-code.entity';
import { PromoUsageEntity } from '../database/entities/promo-usage.entity';
import { UserKeyEntity } from '../database/entities/user-key.entity';
import { BlitzService } from '../blitz/blitz.service';
import { XrayService } from '../xray/xray-service';
import { PriceWithPromoResult } from './types/price-with-promo-result.type';
import { TransactionsService } from '../transactions/transactions.service';
import { I18nService } from '../i18n/i18n.service';
import { CurrencyEnum } from '../transactions/types/currency.enum';
import { DataResponse } from '../api/dto/responses/data-response.dto';
import { PurchaseResult } from './types/purchase-result.type';

@Injectable()
export class KeyPurchaseService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly blitzService: BlitzService,
    private readonly xrayService: XrayService,
    private readonly transactionsService: TransactionsService,
    private readonly i18nService: I18nService,
  ) {}

  async purchase(
    userId: string,
    tariffId: string,
    promoCode?: string,
    protocol: 'xray' | 'hysteria' = 'xray',
  ): Promise<DataResponse<string | PurchaseResult>> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      const user = await qr.manager.findOneOrFail(UserEntity, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });

      const tariff = await qr.manager.findOneOrFail(TariffEntity, {
        where: { id: tariffId, active: true },
      });

      let finalPrice = Number(tariff.price);
      let appliedPromo: PromoCodeEntity | null = null;
      const autoTrialPromoCode =
        finalPrice === 0
          ? tariff.useCascade
            ? 'PREMIUM_TRIAL'
            : 'TRIAL'
          : undefined;
      const effectivePromoCode = promoCode ?? autoTrialPromoCode;

      if (effectivePromoCode) {
        const priceResult = await this.getPriceWithPromo(
          user.id,
          tariff.id,
          effectivePromoCode,
        );
        if (!priceResult.success && typeof priceResult.data === 'string')
          return new DataResponse<string>(priceResult.data);

        if (typeof priceResult.data !== 'string') {
          finalPrice = priceResult.data.finalPrice;
          appliedPromo = priceResult.data.appliedPromo;
        }
      }

      // Бесплатные пробные тарифы выдаем только через соответствующий trial-промокод.
      if (finalPrice === 0 && !appliedPromo) return new DataResponse('error');

      const result = await this.transactionsService.decreaseBalance(
        userId,
        finalPrice,
        CurrencyEnum.RUB,
        qr.manager,
      );

      if (!result) return new DataResponse(this.t(user, 't1'));

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + tariff.expirationDays);

      let createdKeyId: string;
      let vpnUri: string;

      if (protocol === 'xray') {
        const amKey = await this.xrayService.createXrayKey(user, tariff.id);
        if (!amKey) return new DataResponse('error');

        createdKeyId = amKey.id;
        vpnUri = amKey.key;

        await qr.manager.insert(UserKeyEntity, amKey);
      } else {
        const username = crypto.randomUUID().replace(/-/g, '');

        const createResult = await this.blitzService.createUserKey({
          username,
          expirationDays: tariff.expirationDays,
          note: user.id,
        });

        if (!createResult.success) return new DataResponse(`error`);

        const uriResult = await this.blitzService.getUserKeyUri(username);
        if (!uriResult.success || !uriResult.uri)
          return new DataResponse('error');

        vpnUri = uriResult.uri;
        createdKeyId = crypto.randomUUID().replace(/-/g, '');

        await qr.manager.insert(UserKeyEntity, {
          id: createdKeyId,
          key: vpnUri,
          protocol: 'hysteria',
          userId: user.id,
          tariffId: tariff.id,
          expiresAt,
          status: 'active',
        });
      }

      await qr.manager.insert(PaymentsEntity, {
        userId: user.id,
        amount: finalPrice,
        tariffId: tariff.id,
        vpnKeyId: createdKeyId,
      });
      if (appliedPromo) {
        await qr.manager.insert(PromoUsageEntity, {
          userId: user.id,
          promoCodeId: appliedPromo.id,
        });
      }

      await qr.commitTransaction();

      return new DataResponse({ uri: vpnUri, keyId: createdKeyId });
    } catch (e) {
      await qr.rollbackTransaction();
      const msg = e instanceof Error ? e.message : 'Unknown error';
      console.error(
        '[KeyPurchase] purchase: unexpected error',
        msg,
        e instanceof Error ? e.stack : undefined,
      );
      return new DataResponse(`error`);
    } finally {
      await qr.release();
    }
  }

  async getPriceWithPromo(
    userId: string,
    tariffId: string,
    promoCode: string,
  ): Promise<DataResponse<string | PriceWithPromoResult>> {
    const manager = this.dataSource.manager;

    const tariff = await manager.findOne(TariffEntity, {
      where: { id: tariffId, active: true },
    });
    if (!tariff) return new DataResponse('tariff_not_found');

    const promo = await manager.findOne(PromoCodeEntity, {
      where: { code: promoCode, active: true },
    });
    if (!promo) return new DataResponse('error');

    const existingUsage = await manager.findOne(PromoUsageEntity, {
      where: {
        userId,
        promoCodeId: promo.id,
      },
    });
    if (existingUsage) return new DataResponse('free_time_used');

    if (
      promo.allowedTariffIds != null &&
      promo.allowedTariffIds.length > 0 &&
      !promo.allowedTariffIds.includes(tariffId)
    )
      return new DataResponse('free_time_used');

    const originalPrice = Number(tariff.price);
    let finalPrice = originalPrice;
    if (promo.isFreeKey) {
      finalPrice = 0;
    } else if (promo.discountPercent > 0) {
      const discount = (originalPrice * promo.discountPercent) / 100;
      finalPrice = Math.max(0, Math.round(originalPrice - discount));
    }

    return new DataResponse<PriceWithPromoResult>({
      originalPrice,
      finalPrice,
      appliedPromo: promo,
    });
  }

  async renewKey(
    userId: string,
    keyId: string,
    tariffId: string,
    promoCode?: string,
  ): Promise<DataResponse<string | PriceWithPromoResult>> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      const user = await qr.manager.findOneOrFail(UserEntity, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });

      const vpnKey = await qr.manager.findOne(UserKeyEntity, {
        where: { id: keyId, userId: user.id },
        relations: ['tariff'],
      });
      if (!vpnKey) return new DataResponse('key_not_found');

      if (!vpnKey.tariffId || !vpnKey.tariff)
        return new DataResponse('tariff_not_found');

      const tariff = await qr.manager.findOneOrFail(TariffEntity, {
        where: { id: tariffId, active: true },
      });

      let finalPrice = Number(tariff.price);
      let appliedPromo: PromoCodeEntity | null = null;
      const autoTrialPromoCode =
        finalPrice === 0
          ? tariff.useCascade
            ? 'PREMIUM_TRIAL'
            : 'TRIAL'
          : undefined;
      const effectivePromoCode = promoCode ?? autoTrialPromoCode;

      if (effectivePromoCode) {
        const priceResult = await this.getPriceWithPromo(
          user.id,
          tariff.id,
          effectivePromoCode,
        );
        if (!priceResult.success || typeof priceResult.data === 'string')
          return priceResult;

        finalPrice = priceResult.data.finalPrice;
        appliedPromo = priceResult.data.appliedPromo;
      }

      if (finalPrice === 0 && !appliedPromo) return new DataResponse('error');

      const result = await this.transactionsService.decreaseBalance(
        userId,
        finalPrice,
        CurrencyEnum.RUB,
        qr.manager,
      );

      if (!result) return new DataResponse('t1');

      if (vpnKey.protocol === 'hysteria') {
        const isConnected = await this.blitzService.checkConnection();
        if (!isConnected) return new DataResponse('t2');

        const editResult = await this.blitzService.editUser({
          userId: vpnKey.userId,
          expirationDays: tariff.expirationDays,
          renewCreationDate: true,
        });

        if (!editResult.success) return new DataResponse('error');
      } else if (vpnKey.protocol === 'xray') {
        const reactivated = await this.xrayService.reactivateXrayKey(vpnKey.id);
        if (!reactivated) return new DataResponse('error');
      }

      const base = new Date(vpnKey.expiresAt);
      const expiresAt = Date.now() < base.getTime() ? base : new Date();

      expiresAt.setDate(expiresAt.getDate() + tariff.expirationDays);

      const countTrafficLimitDelta = tariff.trafficLimit ?? null;
      const updatePayload: {
        expiresAt: Date;
        status: 'active';
        tariffId: string;
        countTrafficLimit?: () => string;
      } = {
        expiresAt,
        status: 'active',
        tariffId: tariff.id,
      };
      if (countTrafficLimitDelta != null && countTrafficLimitDelta > 0) {
        updatePayload.countTrafficLimit = () =>
          `COALESCE(count_traffic_limit, 0) + ${countTrafficLimitDelta}`;
      }

      await qr.manager
        .createQueryBuilder()
        .update(UserKeyEntity)
        .set(updatePayload)
        .where('id = :id', { id: vpnKey.id })
        .execute();

      await qr.manager.insert(PaymentsEntity, {
        userId: user.id,
        amount: finalPrice,
        tariffId: tariff.id,
        vpnKeyId: vpnKey.id,
      });

      if (appliedPromo) {
        await qr.manager.insert(PromoUsageEntity, {
          userId: user.id,
          promoCodeId: appliedPromo.id,
        });
      }

      await qr.commitTransaction();
      return new DataResponse(vpnKey.id, true);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      await qr.rollbackTransaction();
      return new DataResponse('error');
    } finally {
      await qr.release();
    }
  }

  public t(payload: UserEntity | string, key: string) {
    let lang = 'en';

    if (typeof payload === 'string') lang = payload;
    else if (payload.languageCode) lang = payload.languageCode;

    return this.i18nService.t(lang, key);
  }
}
