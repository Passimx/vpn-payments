import { Injectable } from '@nestjs/common';
import { Context, Markup, Telegraf } from 'telegraf';

import { EntityManager } from 'typeorm';
import { UserEntity } from '../database/entities/user.entity';
import { TransactionEntity } from '../database/entities/transaction.entity';
import { TariffEntity } from '../database/entities/tariff.entity';
import { VpnKeyEntity } from '../database/entities/vpn-key.entity';
import { Envs } from '../../common/env/envs';
import { KeyPurchaseService } from '../key-purchase/key-purchase.service';
import { PaymentsEntity } from '../database/entities/balance-debit.entity';
import { YooMoneyBalanceService } from '../yoomoney/yoomoney-balance.service';

@Injectable()
export class TelegramService {
  private bot: Telegraf;

  private waitingForYooMoneyAmount = new Set<number>();
  private waitingForPromoTariff = new Map<number, string>();
  private pendingPromo = new Map<number, { tariffId: string; promoCode: string }>();

  constructor(
    private readonly em: EntityManager,
    private readonly keyPurchaseService: KeyPurchaseService,
    private readonly yoomoneyBalanceService: YooMoneyBalanceService,
  ) {}

  private readonly initMenu = Markup.inlineKeyboard([
    Markup.button.callback('👤 Профиль', 'BTN_1'),
    Markup.button.callback('📖 Инструкция', 'BTN_4'),
    Markup.button.url('👩‍💻 Поддержка', 'https://t.me/ramzini22'),
  ]);

  private readonly backToMenuButton = Markup.button.callback(
    '⬅️ Назад',
    'BTN_2',
  );

  private readonly backToProfileButton = Markup.button.callback(
    '⬅️ Назад',
    'BTN_1',
  );

  private readonly backToPayWaysButton = Markup.button.callback(
    '⬅️ Назад',
    'BTN_7',
  );

  private readonly backToTariffsButton = Markup.button.callback(
    '⬅️ К тарифам',
    'BTN_9',
  );

  private readonly hiddifyLinks = {
    mac: 'https://github.com/hiddify/hiddify-next/releases',
    windows: 'https://github.com/hiddify/hiddify-next/releases',
    android: 'https://play.google.com/store/apps/details?id=app.hiddify.com',
    ios: 'https://apps.apple.com/app/hiddify-proxy-vpn/id6450514732',
  };

  private readonly startMessage =
    'Преимущества бота:\n\n' +
    '🔐 Надёжность на уровне SUNLIGHT — хрен закроют\n' +
    '🏎️ YouTube 4K без тормозов\n' +
    '💨 Reels — палец не успевает\n' +
    '♾️ Один доступ — windows, ios, android...\n' +
    '🫂 Живая поддержка — мы с людьми, боты работают на нас\n\n' +
    '👇 Выберите действие:';

  onModuleInit() {
    this.bot = new Telegraf(Envs.telegram.botToken);
    this.bot.catch((err) => {
      console.error('Telegraf error:', err);
    });

    this.bot.start(this.onStart);
    this.bot.action('BTN_1', this.onBtn1);
    this.bot.action('BTN_2', this.onBtn2);
    this.bot.action('BTN_3', this.onBtn3);
    this.bot.action('BTN_4', this.onBtn4);
    this.bot.action('BTN_5', this.onBtn5);
    this.bot.action('BTN_6', this.onBtn6);
    this.bot.action('BTN_7', this.onBtn7);
    this.bot.action('BTN_8', this.onBtn8);
    this.bot.action('BTN_9', this.onBtn9);
    this.bot.action('BTN_10', this.onBtn10);
    this.bot.action('BTN_YOOMONEY', this.onYooMoneyBalance);
    this.bot.action(/^T:[\w-]+$/, this.onTariffSelect);
    this.bot.action(/^PROMO:([\w-]+)$/, this.onPromoClick);
    this.bot.action(/^BUY:[\w-]+$/, this.onBuyTariff);
    this.bot.on('text', this.onText);
    this.bot.launch();
  }

  onModuleDestroy() {
    this.bot.stop();
  }

  onStart = async (ctx: Context) => {
    await ctx.reply(this.startMessage, this.initMenu);
    const telegramId = ctx?.from?.id;
    const user = await this.em.findOne(UserEntity, {
      where: { telegramId },
    });
    if (!user) {
      const id = crypto.randomUUID().replace(/-/g, '');
      await this.em.insert(UserEntity, { id, telegramId });
    }
  };

  onBtn1 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
    const telegramId = ctx?.from?.id;
    const user = await this.em.findOne(UserEntity, {
      where: { telegramId },
    });

    if (!user) return;

    await ctx
      .editMessageText(
        `Welcome to PassimX\nБаланс: ${user?.balance ?? 0} руб.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🔑 Мои ключи', 'BTN_5')],
          [Markup.button.callback('🛒 Приобрести ключ', 'BTN_9')],
          [Markup.button.callback('💸 Пополнить баланс', 'BTN_7')],
          [Markup.button.callback('📋 История пополнений', 'BTN_6')],
          [Markup.button.callback('📉 История списаний', 'BTN_10')],
          [this.backToMenuButton],
        ]),
      )
      .catch(() => {});
  };

  onBtn2 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
    await ctx
      .editMessageText('Выбери действие:', this.initMenu)
      .catch(() => {});
  };

  onBtn3 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
    const user = await this.getUserByCtx(ctx);
    if (!user) return;

    await ctx
      .editMessageText(
        `⬇️ <b>РЕКВЕЗИТЫ ДЛЯ ОПЛАТЫ</b>\n` +
          `Для копирования достаточно нажать <b>1 раз</b>️\n\n` +
          `Банк получаетля: <b>T-Банк</b>\n` +
          `Номер телефона: <code>${+79172817235}</code>\n` +
          `Получатель: <b>Рамиль Ильгизович З.</b>\n` +
          `Комментарий: <code>${user.id}</code>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[this.backToPayWaysButton]]),
        },
      )
      .catch(() => {});
  };

  onBtn4 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
    const instructionText =
      '📖 <b>Как подключить ключ</b>\n\n' +
      '1. Установите приложение Hiddify для вашего устройства (кнопки ниже).\n' +
      '2. Откройте приложение → Добавить подписку по ссылке.\n' +
      '3. Вставьте ссылку на подписку (она появляется после покупки ключа).\n\n' +
      'Ссылки на приложение Hiddify:';
    await ctx
      .editMessageText(instructionText, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.url('📱 Android', this.hiddifyLinks.android),
            Markup.button.url('🍎 iOS', this.hiddifyLinks.ios),
          ],
          [
            Markup.button.url('💻 Windows', this.hiddifyLinks.windows),
            Markup.button.url('🍏 Mac', this.hiddifyLinks.mac),
          ],
          [this.backToMenuButton],
        ]),
      })
      .catch(() => {});
  };

  onBtn5 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
    const telegramId = ctx?.from?.id;
    const user = await this.em.findOne(UserEntity, {
      where: { telegramId },
    });
    if (!user) return;

    const keys = await this.em.find(VpnKeyEntity, {
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
      take: 10,
    });

    let text = '<b>🔑 Мои ключи</b>\n\n';

    if (!keys.length) {
      text += 'У тебя пока нет активных ключей.';
    } else {
      text += keys
        .map((k, index) => {
          const statusMap: Record<string, string> = {
            active: 'Активен',
            expired: 'Истёк',
            revoked: 'Отозван',
          };
          const statusText = statusMap[k.status] ?? k.status;
          const expires =
            k.expiresAt &&
            new Date(k.expiresAt).toLocaleDateString('ru-RU', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            });
          const trafficText =
            k.trafficLimitGb === 0 ? 'Безлимит' : `${k.trafficLimitGb} ГБ`;

          return (
            `${index + 1}) <code>${k.vpnUri}</code>\n` +
            `Статус: ${statusText}\n` +
            (expires ? `Действует до: ${expires}\n` : '') +
            `Трафик: ${trafficText}\n`
          );
        })
        .join('\n');
    }

    await ctx
      .editMessageText(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[this.backToProfileButton]]),
      })
      .catch(() => {});
  };

  onBtn6 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
    const telegramId = ctx?.from?.id;
    const user = await this.em.findOne(UserEntity, {
      where: { telegramId },
    });
    if (!user) return;

    const transactions = await this.em.find(TransactionEntity, {
      where: {
        userId: user.id,
        completed: true,
        type: 'Credit',
      },
      order: { createdAt: 'DESC' },
      take: 10,
    });

    let text = '<b>📋 История пополнений</b>\n\n';

    if (!transactions.length) {
      text += 'Пока нет ни одного пополнения.';
    } else {
      text += transactions
        .map((t, index) => {
          const date = new Date(t.createdAt).toLocaleDateString('ru-RU', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          });
          const source = t.place === 'ton' ? 'TON' : 'СБП';
          return `${index + 1}) ${t.amount} ${t.currency} — ${source} (${date})`;
        })
        .join('\n');
    }

    await ctx
      .editMessageText(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[this.backToProfileButton]]),
      })
      .catch(() => {});
  };

  onBtn10 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
    const telegramId = ctx?.from?.id;
    const user = await this.em.findOne(UserEntity, {
      where: { telegramId },
    });
    if (!user) return;

    const payments = await this.em.find(PaymentsEntity, {
      where: {
        userId: user.id,
      },
      order: { createdAt: 'DESC' },
      take: 10,
    });

    let text = '<b>📉 История списаний</b>\n\n';

    if (!payments.length) {
      text += 'Пока не было списаний со счёта.';
    } else {
      text += payments
        .map((p, index) => {
          const date = new Date(p.createdAt).toLocaleDateString('ru-RU', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          });
          return `${index + 1}) ${p.amount} руб. — (${date})`;
        })
        .join('\n');
    }

    await ctx
      .editMessageText(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[this.backToProfileButton]]),
      })
      .catch(() => {});
  };

  onBtn7 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
    await ctx
      .editMessageText(
        'Выбери способ пополнения:',
        Markup.inlineKeyboard([
          [
            Markup.button.callback('📲 СБП', 'BTN_3'),
            Markup.button.callback('💎 ТОН', 'BTN_8'),
            Markup.button.callback('💳 YooMoney', 'BTN_YOOMONEY'),
          ],
          [this.backToProfileButton],
        ]),
      )
      .catch(() => {});
  };

  onYooMoneyBalance = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
    const user = await this.getUserByCtx(ctx);
    if (!user) return;
    this.waitingForYooMoneyAmount.add(ctx.from!.id);
    await ctx
      .editMessageText('💳 <b>YooMoney</b>\n\nВведите сумму (руб.):', {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[this.backToPayWaysButton]]),
      })
      .catch(() => {});
  };

  private async getUserByCtx(ctx: Context): Promise<UserEntity | null> {
    const telegramId = ctx?.from?.id;
    if (!telegramId) return null;
    return this.em.findOne(UserEntity, { where: { telegramId } });
  }

  onBtn8 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
    const user = await this.getUserByCtx(ctx);
    if (!user) return;

    await ctx
      .editMessageText(
        `⬇️ <b>РЕКВЕЗИТЫ ДЛЯ ОПЛАТЫ</b>\n` +
          `Для копирования достаточно нажать <b>1 раз</b>️\n\n` +
          `Адрес кошелька: <code>${Envs.ton.walletAddress}</code>\n` +
          `Принимаемые монеты: <b>TON</b>\n` +
          `Комментарий: <code>${user.id}</code>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[this.backToPayWaysButton]]),
        },
      )
      .catch(() => {});
  };

  onBtn9 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
    const tariffs = await this.em.find(TariffEntity, {
      where: { active: true },
    });

    if (!tariffs.length) {
      await ctx
        .editMessageText(
          'Сейчас нет доступных тарифов.',
          Markup.inlineKeyboard([[this.backToProfileButton]]),
        )
        .catch(() => {});
      return;
    }

    const tariffButtons = tariffs.map((t) => [
      Markup.button.callback(`${t.name} — ${t.price} руб.`, `T:${t.id}`),
    ]);

    await ctx
      .editMessageText('📋 <b>Выбери тариф:</b>', {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          ...tariffButtons,
          [this.backToProfileButton],
        ]),
      })
      .catch(() => {});
  };

  onTariffSelect = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
    const telegramId = ctx?.from?.id;
    if (telegramId) {
      this.waitingForPromoTariff.delete(telegramId);
      this.pendingPromo.delete(telegramId);
    }
    const callbackData = (ctx.callbackQuery as { data?: string })?.data ?? '';
    const tariffId = callbackData.replace('T:', '');

    const tariff = await this.em.findOne(TariffEntity, {
      where: { id: tariffId, active: true },
    });
    if (!tariff) {
      await ctx.answerCbQuery('Тариф не найден.').catch(() => {});
      return;
    }

    const trafficText =
      tariff.isUnlimited || tariff.trafficGb === 0
        ? 'Безлимит'
        : `${tariff.trafficGb} GB`;
    const text =
      `📦 <b>${tariff.name}</b>\n\n` +
      `📊 Трафик: ${trafficText}\n` +
      `📅 Срок: ${tariff.expirationDays} дн.\n` +
      `💰 Цена: ${tariff.price} руб.\n`;

    await ctx
      .editMessageText(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Купить', `BUY:${tariff.id}`),
            Markup.button.callback('🎟 Промокод', `PROMO:${tariff.id}`),
          ],
          [this.backToTariffsButton],
        ]),
      })
      .catch(() => {});
  };

  onPromoClick = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
    const data = (ctx.callbackQuery as { data?: string })?.data ?? '';
    const tariffId = data.replace('PROMO:', '');
    const telegramId = ctx?.from?.id;
    if (!telegramId) return;
    this.waitingForPromoTariff.set(telegramId, tariffId);
    await ctx
      .editMessageText('🎟 Введите промокод:', {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ К тарифу', `T:${tariffId}`)],
        ]),
      })
      .catch(() => {});
  };

  onBuyTariff = async (ctx: Context) => {
    const callbackData = (ctx.callbackQuery as { data?: string })?.data ?? '';
    const tariffId = callbackData.replace('BUY:', '');
    const telegramId = ctx?.from?.id;
    const user = await this.getUserByCtx(ctx);
    if (!user) {
      await ctx.answerCbQuery('Сначала нажми /start').catch(() => {});
      return;
    }

    await ctx.answerCbQuery('Обработка...').catch(() => {});

    const promo = telegramId ? this.pendingPromo.get(telegramId) : undefined;
    const promoCode =
      promo?.tariffId === tariffId ? promo.promoCode : undefined;
    if (telegramId && promo?.tariffId === tariffId)
      this.pendingPromo.delete(telegramId);

    const result = await this.keyPurchaseService.purchase(
      user.id,
      tariffId,
      promoCode,
    );

    if (!result.ok) {
      await ctx
        .editMessageText(`❌ ${result.error}`, {
          ...Markup.inlineKeyboard([[this.backToTariffsButton]]),
        })
        .catch(() => {});
      return;
    }

    const text =
      `✅ <b>Ключ создан</b>\n\n` +
      `Подписка (нажми, чтобы скопировать):\n<code>${result.uri}</code>\n\n` +
      `Как применить: откройте Hiddify → Добавить по ссылке → вставьте ссылку выше. Если приложения нет — нажмите кнопку для вашей ОС ниже.`;

    await ctx
      .editMessageText(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.url('📱 Android', this.hiddifyLinks.android),
            Markup.button.url('🍎 iOS', this.hiddifyLinks.ios),
          ],
          [
            Markup.button.url('💻 Windows', this.hiddifyLinks.windows),
            Markup.button.url('🍏 Mac', this.hiddifyLinks.mac),
          ],
          [
            Markup.button.callback('🛒 Ещё ключ', 'BTN_9'),
            this.backToProfileButton,
          ],
        ]),
      })
      .catch(() => {});
  };

  onText = async (ctx: Context) => {
    const telegramId = ctx?.from?.id;
    if (!telegramId) return;
    const text = (ctx.message as { text?: string })?.text?.trim() ?? '';

    const tariffId = this.waitingForPromoTariff.get(telegramId);
    if (tariffId) {
      this.waitingForPromoTariff.delete(telegramId);
      const user = await this.getUserByCtx(ctx);
      if (!user) return;
      const priceResult = await this.keyPurchaseService.getPriceWithPromo(
        user.id,
        tariffId,
        text,
      );
      if (!priceResult.ok) {
        await ctx.reply(`❌ ${priceResult.error}`).catch(() => {});
        return;
      }
      this.pendingPromo.set(telegramId, { tariffId, promoCode: text });
      await ctx
        .reply(
          `✅ Промокод применён. Цена: <b>${priceResult.finalPrice} руб.</b> Нажмите Купить:`,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('✅ Купить', `BUY:${tariffId}`)],
              [this.backToTariffsButton],
            ]),
          },
        )
        .catch(() => {});
      return;
    }

    if (!this.waitingForYooMoneyAmount.has(telegramId)) return;
    const user = await this.getUserByCtx(ctx);
    if (!user) {
      this.waitingForYooMoneyAmount.delete(telegramId);
      return;
    }
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply('❌ Введите число, например 100').catch(() => {});
      return;
    }
    this.waitingForYooMoneyAmount.delete(telegramId);
    const result = await this.yoomoneyBalanceService.createBalancePaymentLink(
      user.id,
      amount,
    );
    if (!result.ok) {
      await ctx.reply(`❌ ${result.error}`).catch(() => {});
      return;
    }
    await ctx
      .reply(`💳 Сумма: <b>${amount} руб.</b>\n\nНажмите кнопку для оплаты:`, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.url('💳 Оплатить', result.paymentUrl)],
          [this.backToPayWaysButton],
        ]),
      })
      .catch(() => {});
  };
}
