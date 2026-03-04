import { Injectable } from '@nestjs/common';
import { Context, Input, Markup, Telegraf } from 'telegraf';

import { EntityManager } from 'typeorm';
import { UserEntity } from '../database/entities/user.entity';
import { TariffEntity } from '../database/entities/tariff.entity';
import { UserKeyEntity } from '../database/entities/user-key.entity';
import { Envs } from '../../common/env/envs';
import { KeyPurchaseService } from '../key-purchase/key-purchase.service';
import { YookassaBalanceService } from '../yookassa/yookassa-balance.service';
import { TransactionsService } from '../transactions/transactions.service';
import path from 'node:path';

@Injectable()
export class TelegramService {
  private bot: Telegraf;

  private amountMap = new Map<number, number>();
  private waitingForPromo = new Map<number, { id: string; isRenew: boolean }>();
  private pendingPromo = new Map<
    number,
    { id: string; promoCode: string; isRenew: boolean }
  >();

  constructor(
    private readonly em: EntityManager,
    private readonly keyPurchaseService: KeyPurchaseService,
    private readonly transactionsService: TransactionsService,
    private readonly yookassaBalanceService: YookassaBalanceService,
  ) {}

  private readonly initMenu = Markup.inlineKeyboard([
    [Markup.button.callback('🌐️ Меню', 'BTN_1')],
    [
      Markup.button.callback('📖 Инструкция', 'ON_INSTRUCTION'),
      Markup.button.url('👩‍💻 Поддержка', 'https://t.me/passimx'),
    ],
    [
      Markup.button.url(
        '📄 Пользовательское соглашение',
        'https://passimx.ru/info/ru/vpn-user-agreement.html',
      ),
    ],
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
    'ADD_BALANCE',
  );

  private readonly backToSetAmountButton = Markup.button.callback(
    '⬅️ Назад',
    'BTN_BALANCE',
  );

  private readonly backToTariffsButton = Markup.button.callback(
    '⬅️ К тарифам',
    'BTN_9',
  );

  private readonly downloadLinks = {
    mac: 'https://github.com/amnezia-vpn/amnezia-client/releases/download/4.8.12.9/AmneziaVPN_4.8.12.9_macos.pkg',
    windows:
      'https://github.com/amnezia-vpn/amnezia-client/releases/download/4.8.12.9/AmneziaVPN_4.8.12.9_x64.exe',
    android:
      'https://play.google.com/store/apps/details?id=org.amnezia.vpn&utm_source=amnezia.org&utm_campaign=organic&utm_medium=referral',
    ios: 'https://apps.apple.com/ru/app/defaultvpn/id6744725017',
  };

  private readonly startMessage =
    'Добро пожаловать в PassimX VPN:\n' +
    'Преимущества бота:\n\n' +
    '🔐 Надёжность шифрования трафика\n' +
    '🏎️ Стабильная скорость передачи данных\n' +
    '🚌 Равномерное распределение пользователей по серверам\n' +
    '💨 Серверы не ведут журналы подключений или активности\n' +
    '🫂 Служба поддержки ответит на все ваши вопросы\n\n' +
    '👇 Выберите действие:';

  onModuleInit() {
    this.bot = new Telegraf(Envs.telegram.botToken);
    this.bot.catch((err) => {
      console.error('Telegraf error:', err);
    });

    this.bot.start(this.onStart);
    this.bot.action('BTN_1', this.onBtn1);
    this.bot.action('BTN_2', this.onBtn2);
    this.bot.action('ON_INSTRUCTION', this.onInstruction);
    this.bot.action('BTN_4', this.onBtn4);
    this.bot.action('BTN_5', this.onBtn5);
    this.bot.action('BTN_8', this.onBtn8);
    this.bot.action('BTN_9', this.onBtn9);
    this.bot.action('BTN_10', this.onBtn10);
    this.bot.action('BTN_11', this.onBtn11);
    this.bot.action('BTN_13', this.onBtn13);
    this.bot.action('BTN_14', this.onBtn14);
    this.bot.action('BTN_15', this.onBtn15);
    this.bot.action('BTN_16', this.onBtn16);
    this.bot.action('BTN_17', this.onBtn17);
    this.bot.action('BTN_BALANCE', this.onBalance);
    this.bot.action('ADD_BALANCE', this.onAddBalance);
    this.bot.action('ON_ADD_BALANCE_INSTRUCTION', this.onAddBalanceInstruction);
    this.bot.action(/^T:[\w-]+$/, this.onTariffSelect);
    this.bot.action(/^PROMO:([\w-]+)$/, this.onPromoClick);
    this.bot.action(/^BUY:[\w-]+$/, this.onBuyTariff);
    this.bot.action(/^BUY_XRAY:[\w-]+$/, this.onBuyTariff);
    this.bot.action(/^BUY_HYST:[\w-]+$/, this.onBuyTariff);
    this.bot.action(/^BUY_KEY:([\w-]+)$/, this.onBuyTariff);
    this.bot.action(/^RENEW:([\w-]+)$/, this.onRenewKey);
    this.bot.action(/^PROMO_KEY:([\w-]+)$/, this.onRenewPromo);
    this.bot.action(/^BUTTON_MONEY:([\w-]+)$/, this.onSetButtonMoney);
    this.bot.on('text', this.onText);
    void this.bot.launch();
  }

  onModuleDestroy() {
    this.bot.stop();
  }

  onStart = async (ctx: Context) => {
    await ctx.reply(this.startMessage, this.initMenu);
    const telegramId = ctx?.from?.id;
    const chatId = ctx?.chat?.id;
    const user = await this.em.findOne(UserEntity, {
      where: { telegramId },
    });
    if (!user) {
      const id = crypto.randomUUID().replace(/-/g, '');
      await this.em.insert(UserEntity, {
        id,
        telegramId,
        chatId,
        userName: ctx?.from?.username,
      });
    }
  };

  onBtn1 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
    const telegramId = ctx?.from?.id;
    const user = await this.em.findOne(UserEntity, {
      where: { telegramId },
    });

    if (!user) return;
    this.amountMap.delete(telegramId!);

    await ctx
      .editMessageText(
        `ID: ${user.id}\nБаланс: ${user.balance} руб.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🔑 Мои ключи', 'BTN_5')],
          [Markup.button.callback('🛒 Приобрести ключ', 'BTN_9')],
          [Markup.button.callback('💸 Пополнить баланс', 'BTN_BALANCE')],
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

  onAddBalanceInstruction = async (ctx: Context) => {
    const message = await ctx.reply('Загрузка видео...');

    const filePath = path.join(
      process.cwd(),
      'public',
      'media',
      'add-balance.mp4',
    );

    await ctx.replyWithVideo(Input.fromLocalFile(filePath), {
      caption:
        'Видео инструкция: Как пополнить баланс\n\nНеобходимые шаги:\nМеню -> Пополнить баланс -> Ввод суммы -> Выбор способа оплаты -> Оплата',
      width: 720,
      height: 1280,
      supports_streaming: true,
    });
    await this.bot.telegram.deleteMessage(ctx.chat!.id, message.message_id);
    await ctx.reply('Выбери действие:', this.initMenu).catch(() => {});
  };

  onInstruction = async (ctx: Context) => {
    await ctx.answerCbQuery().catch(() => {});
    await ctx
      .editMessageText('Выбери действие:', {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              '💸 Как пополнить баланс',
              `ON_ADD_BALANCE_INSTRUCTION`,
            ),
          ],
          [Markup.button.callback('🔐 Как подключить ключ', `BUTTON_MONEY:50`)],
          [Markup.button.callback('📲 Ссылки на приложение', `BTN_4`)],
          [this.backToMenuButton],
        ]),
      })
      .catch(() => {});
  };

  onBtn4 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
    const instructionText = '📲 <b>Ссылки на приложение:</b>';
    await ctx
      .editMessageText(instructionText, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.url('📱 Android', this.downloadLinks.android),
            Markup.button.url('🍎 iOS', this.downloadLinks.ios),
          ],
          [
            Markup.button.url('💻 Windows', this.downloadLinks.windows),
            Markup.button.url('🍏 Mac', this.downloadLinks.mac),
          ],
          [Markup.button.callback('⬅️ Назад', 'ON_INSTRUCTION')],
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

    const keys = await this.em.find(UserKeyEntity, {
      where: { userId: user.id },
      relations: ['tariff'],
      order: { createdAt: 'DESC' },
      take: 10,
    });

    const visibleKeys = keys.filter(
      (k) =>
        !(
          k.tariff?.id === Envs.telegram.trialTariffId && k.status === 'expired'
        ),
    );

    let text = '<b>🔑 Мои ключи</b>\n\n';

    if (!visibleKeys.length) {
      text += 'У тебя пока нет активных ключей.';
    } else {
      const indexedKeys = visibleKeys.map((k, index) => ({ k, index }));

      const keyRows = indexedKeys
        .filter(({ k }) => k.tariff?.id !== Envs.telegram.trialTariffId)
        .map(({ k, index }) => {
          const base = k.expiresAt ? new Date(k.expiresAt) : new Date();
          const renewedAt = new Date(base);
          renewedAt.setDate(
            renewedAt.getDate() + (k.tariff?.expirationDays ?? 0),
          );
          const dateStr = renewedAt.toLocaleDateString('ru-RU', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          });
          return [
            Markup.button.callback(
              `🔄 Продлить ключ ${index + 1} (Продлить до ${dateStr})`,
              `RENEW:${k.id}`,
            ),
          ];
        });

      text += indexedKeys
        .map(({ k, index }) => {
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
          const trafficText = 'Безлимит';
          return (
            `${index + 1}) [${k.protocol}] <code>${k.key}</code>\n` +
            `Статус: ${statusText}\n` +
            (expires ? `Действует до: ${expires}\n` : '') +
            `Трафик: ${trafficText}\n`
          );
        })
        .join('\n');

      await ctx
        .editMessageText(text, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([...keyRows, [this.backToProfileButton]]),
        })
        .catch((e) => console.log(e));
      // .catch(() => {});
      return;
    }

    await ctx
      .editMessageText(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[this.backToProfileButton]]),
      })
      .catch((e) => console.log(e));
    // .catch(() => {});
  };

  onSetButtonMoney = async (ctx: Context) => {
    const user = await this.getUserByCtx(ctx);
    if (!user) return;
    ctx.answerCbQuery().catch(() => {});
    const callbackData = (ctx.callbackQuery as { data?: string })?.data ?? '';
    const amount = Number(callbackData.replace(/^(BUTTON_MONEY):/, ''));
    this.amountMap.set(ctx.from!.id, amount);
    const payload = await this.getPayloadForAddBalance(user);
    if (!payload) return;
    await ctx.editMessageText(payload.text, payload.extra);
  };

  onBalance = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
    const user = await this.getUserByCtx(ctx);
    if (!user) return;
    this.amountMap.set(ctx.from!.id, 0);
    await ctx
      .editMessageText('💳 <b>Введите сумму (руб.)</b>:', {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('50 руб', `BUTTON_MONEY:50`),
            Markup.button.callback('100 руб', `BUTTON_MONEY:100`),
          ],
          [
            Markup.button.callback('300 руб', `BUTTON_MONEY:300`),
            Markup.button.callback('500 руб', `BUTTON_MONEY:500`),
          ],
          [this.backToProfileButton],
        ]),
      })
      .catch(() => {});
  };

  private async getUserByCtx(ctx: Context): Promise<UserEntity | null> {
    const telegramId = ctx?.from?.id;
    if (!telegramId) return null;
    return this.em.findOne(UserEntity, { where: { telegramId } });
  }

  private async showTariffScreen(
    ctx: Context,
    tariff: TariffEntity,
    opts: {
      buyCallback: string;
      promoCallback: string;
      backCallback: string;
    },
  ): Promise<void> {
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
            Markup.button.callback('✅ Купить', opts.buyCallback),
            Markup.button.callback('🎟 Промокод', opts.promoCallback),
          ],
          [Markup.button.callback('⬅️ Назад', opts.backCallback)],
        ]),
      })
      .catch(() => {});
  }

  private async askPromoCode(
    ctx: Context,
    backCallback: string,
  ): Promise<void> {
    await ctx
      .editMessageText('🎟 Введите промокод:', {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Назад', backCallback)],
        ]),
      })
      .catch(() => {});
  }

  onBtn8 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
    const user = await this.getUserByCtx(ctx);
    if (!user) return;
    const amountFromSet = this.amountMap.get(ctx.from!.id);
    if (amountFromSet === undefined) return;

    const priceCollection = await this.transactionsService.getCurrencyPrice();
    if (!priceCollection) return;

    const address = Envs.crypto.ton.walletAddress;
    const text = user.id;
    const value =
      (1 / priceCollection['the-open-network'].rub) * amountFromSet * 1e9;
    const amount = Math.ceil(value);

    await ctx
      .editMessageText(
        `⬇️ <b>РЕКВЕЗИТЫ ДЛЯ ОПЛАТЫ</b>\n` +
          `Для копирования достаточно нажать <b>1 раз</b>️\n\n` +
          `Адрес кошелька: <code>${Envs.crypto.ton.walletAddress}</code>\n` +
          `Сумма: <code>${amount / 1e9}</code> TON\n` +
          `Принимаемые монеты: <b>TON</b>, <b>USDT</b>\n` +
          `Комментарий: <code>${user.id}</code>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('TON (выбрано)', `BTN_8`),
              Markup.button.callback('USDT', `BTN_11`),
            ],
            [
              Markup.button.url(
                'MyTonWallet',
                `https://my.tt/transfer/${address}?text=${text}&amount=${amount}`,
              ),
            ],
            [
              Markup.button.url(
                'Tonkeeper',
                `https://app.tonkeeper.com/transfer/${address}?text=${text}&amount=${amount}`,
              ),
            ],
            [
              Markup.button.url(
                'Tonhub',
                `https://tonhub.com/transfer/${address}?text=${text}&amount=${amount}`,
              ),
            ],
            [this.backToPayWaysButton],
          ]),
        },
      )
      .catch(() => {});
  };

  onBtn11 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
    const user = await this.getUserByCtx(ctx);
    if (!user) return;
    const amountFromSet = this.amountMap.get(ctx.from!.id);
    if (amountFromSet === undefined) return;

    const priceCollection = await this.transactionsService.getCurrencyPrice();
    if (!priceCollection) return;

    const address = Envs.crypto.ton.walletAddress;
    const text = user.id;
    const jetton = '&jetton=EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';
    const value = (1 / priceCollection.usd.rub) * amountFromSet * 1e6;
    const amount = Math.ceil(value);

    await ctx
      .editMessageText(
        `⬇️ <b>РЕКВЕЗИТЫ ДЛЯ ОПЛАТЫ</b>\n` +
          `Для копирования достаточно нажать <b>1 раз</b>️\n\n` +
          `Адрес кошелька: <code>${Envs.crypto.ton.walletAddress}</code>\n` +
          `Сумма: <code>${amount / 1e6}</code> USDT\n` +
          `Принимаемые монеты: <b>TON</b>, <b>USDT</b>\n` +
          `Комментарий: <code>${user.id}</code>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('TON', `BTN_8`),
              Markup.button.callback('USDT (выбрано)', `BTN_11`),
            ],
            [
              Markup.button.url(
                'MyTonWallet',
                `https://my.tt/transfer/${address}?text=${text}&amount=${amount}${jetton}`,
              ),
            ],
            [
              Markup.button.url(
                'Tonkeeper',
                `https://app.tonkeeper.com/transfer/${address}?text=${text}&amount=${amount}${jetton}`,
              ),
            ],
            [
              Markup.button.url(
                'Tonhub',
                `https://tonhub.com/transfer/${address}?text=${text}&amount=${amount}${jetton}`,
              ),
            ],
            [this.backToPayWaysButton],
          ]),
        },
      )
      .catch(() => {});
  };

  onBtn10 = (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
  };

  onBtn13 = (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
  };

  onBtn14 = (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
  };

  onBtn15 = (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
  };

  onBtn16 = (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
  };

  onBtn17 = (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
  };

  onBtn9 = async (ctx: Context) => {
    const telegramId = ctx?.from?.id;
    const user = await this.em.findOne(UserEntity, {
      where: { telegramId },
    });

    if (!user) return;

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
      .editMessageText(`Баланс: ${user.balance} руб.\n<b>Выберите тариф:</b>`, {
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
      this.waitingForPromo.delete(telegramId);
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

    await this.showTariffScreen(ctx, tariff, {
      buyCallback: `BUY:${tariff.id}`,
      promoCallback: `PROMO:${tariff.id}`,
      backCallback: 'BTN_9',
    });
  };

  onPromoClick = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
    const data = (ctx.callbackQuery as { data?: string })?.data ?? '';
    const tariffId = data.replace('PROMO:', '');
    const telegramId = ctx?.from?.id;
    if (!telegramId) return;
    this.waitingForPromo.set(telegramId, { id: tariffId, isRenew: false });
    await this.askPromoCode(ctx, `T:${tariffId}`);
  };

  private async showKeyCreatedScreen(
    ctx: Context,
    uri: string,
    backButton: any,
  ): Promise<void> {
    const text =
      `✅ <b>Ключ создан</b>\n\n` +
      `Подписка (нажми, чтобы скопировать):\n<code>${uri}</code>\n\n` +
      `Как применить: Нажмите на ссылку (ключь) выше → откройте AmneziaVPN/(для ios DefaultVPN) → нажмите на значек "+" → Нажмите Вставить/Insert. Если приложения нет — нажмите кнопку для вашей ОС ниже.`;

    await ctx
      .editMessageText(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.url('📱 Android', this.downloadLinks.android),
            Markup.button.url('🍎 iOS', this.downloadLinks.ios),
          ],
          [
            Markup.button.url('💻 Windows', this.downloadLinks.windows),
            Markup.button.url('🍏 Mac', this.downloadLinks.mac),
          ],
          [Markup.button.callback('🛒 Ещё ключ', 'BTN_9'), backButton],
        ] as unknown as Parameters<typeof Markup.inlineKeyboard>[0]),
      })
      .catch(() => {});
  }

  onBuyTariff = async (ctx: Context) => {
    const callbackData = (ctx.callbackQuery as { data?: string })?.data ?? '';
    const isRenew = callbackData.startsWith('BUY_KEY:');
    /*
    //  без выбора протокола — показываем выбор
    if (!isRenew && callbackData.startsWith('BUY:')) {
      const tariffId = callbackData.replace('BUY:', '');
      await ctx
        .editMessageText('Выберите протокол подключения:', {
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('Amnezia (Xray)', `BUY_XRAY:${tariffId}`),
              Markup.button.callback(
                'Hiddify (Hysteria)',
                `BUY_HYST:${tariffId}`,
              ),
            ],
            [Markup.button.callback('⬅️ Назад к тарифу', `T:${tariffId}`)],
          ]),
        })
        .catch(() => {});
      return;
    }
    */
    let protocol: 'xray' | 'hysteria' = 'xray';
    let id = callbackData;

    if (callbackData.startsWith('BUY_XRAY:')) {
      protocol = 'xray';
      id = callbackData.replace('BUY_XRAY:', '');
    } else if (callbackData.startsWith('BUY_HYST:')) {
      protocol = 'hysteria';
      id = callbackData.replace('BUY_HYST:', '');
    } else {
      //  по умолчанию Xray
      id = callbackData.replace(/^(BUY|BUY_KEY):/, '');
      protocol = 'xray';
    }
    const telegramId = ctx?.from?.id;
    const user = await this.getUserByCtx(ctx);
    if (!user) {
      await ctx.answerCbQuery('Сначала нажми /start').catch(() => {});
      return;
    }

    await ctx.answerCbQuery('Обработка...').catch(() => {});

    if (isRenew) {
      const promo = telegramId ? this.pendingPromo.get(telegramId) : undefined;
      const promoCode =
        promo?.id === id && promo?.isRenew ? promo.promoCode : undefined;
      if (telegramId && promo?.id === id && promo?.isRenew)
        this.pendingPromo.delete(telegramId);

      const result = await this.keyPurchaseService.renewKey(
        user.id,
        id,
        promoCode,
      );
      if (!result.ok) {
        await ctx
          .editMessageText(`❌ ${result.error}`, {
            ...Markup.inlineKeyboard([
              [Markup.button.callback('💸 Пополнить баланс', 'BTN_BALANCE')],
              [Markup.button.callback('⬅️ Назад', 'BTN_5')],
            ]),
          })
          .catch(() => {});
        return;
      }

      await ctx
        .editMessageText(
          `✅ <b>Ключ продлён</b>\n\nКлюч обновлён и снова активен.`,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔑 Мои ключи', 'BTN_5')],
              [this.backToProfileButton],
            ]),
          },
        )
        .catch(() => {});
    } else {
      const promo = telegramId ? this.pendingPromo.get(telegramId) : undefined;
      const promoCode =
        id === Envs.telegram.trialTariffId
          ? 'TRIAL'
          : promo?.id === id && !promo?.isRenew
            ? promo.promoCode
            : undefined;
      if (telegramId && promo?.id === id && !promo?.isRenew)
        this.pendingPromo.delete(telegramId);

      const result = await this.keyPurchaseService.purchase(
        user.id,
        id,
        promoCode,
        protocol,
      );
      if (!result.ok) {
        await ctx
          .editMessageText(`❌ ${result.error}`, {
            ...Markup.inlineKeyboard([
              [Markup.button.callback('💸 Пополнить баланс', 'BTN_BALANCE')],
              [Markup.button.callback('⬅️ Назад', 'BTN_9')],
            ]),
          })
          .catch(() => {});
        return;
      }

      await this.showKeyCreatedScreen(
        ctx,
        result.uri,
        this.backToProfileButton,
      );
    }
  };

  onRenewKey = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
    const data = (ctx.callbackQuery as { data?: string })?.data ?? '';
    const keyId = data.replace('RENEW:', '');
    const user = await this.getUserByCtx(ctx);
    if (!user) return;

    const vpnKey = await this.em.findOne(UserKeyEntity, {
      where: { id: keyId, userId: user.id },
      relations: ['tariff'],
    });
    if (!vpnKey || !vpnKey.tariffId || !vpnKey.tariff) {
      await ctx.answerCbQuery('Ключ или тариф не найден').catch(() => {});
      return;
    }

    await this.showTariffScreen(ctx, vpnKey.tariff, {
      buyCallback: `BUY_KEY:${keyId}`,
      promoCallback: `PROMO_KEY:${keyId}`,
      backCallback: 'BTN_5',
    });
  };

  onRenewPromo = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
    const data = (ctx.callbackQuery as { data?: string })?.data ?? '';
    const keyId = data.replace('PROMO_KEY:', '');
    const telegramId = ctx?.from?.id;
    if (!telegramId) return;
    this.waitingForPromo.set(telegramId, { id: keyId, isRenew: true });
    await this.askPromoCode(ctx, `RENEW:${keyId}`);
  };

  private async handlePromoCode(
    ctx: Context,
    telegramId: number,
    promoText: string,
    isRenew: boolean,
    id: string,
  ): Promise<boolean> {
    const user = await this.getUserByCtx(ctx);
    if (!user) return false;

    let tariffId: string;
    if (isRenew) {
      const vpnKey = await this.em.findOne(UserKeyEntity, {
        where: { id, userId: user.id },
        relations: ['tariff'],
      });
      if (!vpnKey || !vpnKey.tariffId || !vpnKey.tariff) {
        await ctx.reply('❌ Ключ не найден').catch(() => {});
        return false;
      }
      tariffId = vpnKey.tariff.id;
    } else {
      tariffId = id;
    }

    const priceResult = await this.keyPurchaseService.getPriceWithPromo(
      user.id,
      tariffId,
      promoText,
    );
    if (!priceResult.ok) {
      const backCallback = isRenew ? `RENEW:${id}` : `T:${tariffId}`;
      await ctx
        .reply(`❌ ${priceResult.error}`, {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Назад', backCallback)],
          ]),
        })
        .catch(() => {});
      return false;
    }

    if (isRenew) {
      this.pendingPromo.set(telegramId, {
        id,
        promoCode: promoText,
        isRenew: true,
      });
      await ctx
        .reply(
          `✅ Промокод применён. Цена: <b>${priceResult.finalPrice} руб.</b> Нажмите Купить:`,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('✅ Купить', `BUY_KEY:${id}`)],
              [Markup.button.callback('⬅️ К ключам', 'BTN_5')],
            ]),
          },
        )
        .catch(() => {});
    } else {
      this.pendingPromo.set(telegramId, {
        id: tariffId,
        promoCode: promoText,
        isRenew: false,
      });
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
    }
    return true;
  }

  onAddBalance = async (ctx: Context) => {
    const telegramId = ctx?.from?.id;
    if (!telegramId) return;
    const user = await this.getUserByCtx(ctx);
    if (!user) {
      this.amountMap.delete(telegramId);
      return;
    }

    const payload = await this.getPayloadForAddBalance(user);
    if (!payload) return;
    await ctx.editMessageText(payload.text, payload.extra);
  };

  onText = async (ctx: Context) => {
    const telegramId = ctx?.from?.id;
    if (!telegramId) return;
    const text = (ctx.message as { text?: string })?.text?.trim() ?? '';

    const waitingPromo = this.waitingForPromo.get(telegramId);
    if (waitingPromo) {
      this.waitingForPromo.delete(telegramId);
      await this.handlePromoCode(
        ctx,
        telegramId,
        text,
        waitingPromo.isRenew,
        waitingPromo.id,
      );
      return;
    }

    if (!this.amountMap.has(telegramId)) return;
    const user = await this.getUserByCtx(ctx);
    if (!user) {
      this.amountMap.delete(telegramId);
      return;
    }
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply('❌ Введите число, например 100').catch(() => {});
      return;
    }
    this.amountMap.set(telegramId, amount);

    const payload = await this.getPayloadForAddBalance(user);
    if (!payload) return;
    await ctx.reply(payload.text, payload.extra);
  };

  public async sendMessageAddBalance(userId: string, balance: number) {
    const user = await this.em.findOne(UserEntity, { where: { id: userId } });
    if (!user?.chatId) return;

    await this.bot.telegram.sendMessage(
      user.chatId,
      `Пополнен баланс на сумму <b>${Math.ceil(balance)} руб.</b>`,
      { parse_mode: 'HTML' },
    );
    await this.bot.telegram.sendMessage(
      user.chatId,
      'Выбери действие:',
      this.initMenu,
    );
  }

  public async sendAlmostExpiredKey(user: UserEntity) {
    if (!user.chatId) return;

    await this.bot.telegram.sendMessage(
      user.chatId,
      `Срок действия ключа подходит к концу.\nБаланс: ${user.balance}`,
      Markup.inlineKeyboard([
        ...user.keys
          .filter((key) => key.tariff?.id !== Envs.telegram.trialTariffId)
          .map((key, index) => [
            Markup.button.callback(
              `🔄 Продлить ключ ${index + 1}`,
              `RENEW:${key.id}`,
            ),
          ]),
        [this.backToProfileButton],
      ]),
    );
  }

  private getPayloadForAddBalance = async (user: UserEntity) => {
    const amount = this.amountMap.get(user.telegramId!);
    if (!amount) return;
    const result = await this.yookassaBalanceService.createBalancePaymentLink(
      user.id,
      amount,
    );
    const text: string =
      `Сумма пополнения: ${amount} руб.\n` + 'Выбери способ пополнения:';
    const extra = Markup.inlineKeyboard([
      result.ok
        ? [
            Markup.button.callback(
              `💎 ТОН (+${Envs.crypto.allowance * 100}%)`,
              'BTN_8',
            ),
            Markup.button.url('💳 YooKassa', result.paymentUrl),
          ]
        : [
            Markup.button.callback(
              `💎 ТОН (+${Envs.crypto.allowance * 100}%)`,
              'BTN_8',
            ),
          ],
      [this.backToSetAmountButton],
    ]);

    return { text, extra };
  };
}
