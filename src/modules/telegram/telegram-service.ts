import { forwardRef, Inject, Injectable } from '@nestjs/common';
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
import { I18nService } from '../i18n/i18n.service';
import { AmneziaService } from '../amnezia/amnezia-service';
import { ServerEntity } from '../database/entities/server.entity';

@Injectable()
export class TelegramService {
  private bot: Telegraf;

  private amountMap = new Map<number, number>();
  private addKeyVideoId: string | undefined = Envs.telegram.addKeyVideoId;
  private addBalanceVideoId: string | undefined =
    Envs.telegram.addBalanceVideoId;
  private welcomeVideoId: string | undefined = Envs.telegram.welcomeVideoId;
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
    private readonly i18nService: I18nService,
    @Inject(forwardRef(() => AmneziaService))
    private readonly amneziaService: AmneziaService,
  ) {}

  async onModuleInit() {
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
    this.bot.action(/^MIGRATE_SERVER:([\w-]+)$/, this.onMigrateServer);
    this.bot.action(/^MIGRATE_SERVER_COUNTRY:.+$/, this.onMigrateServerCountry);
    this.bot.action(/^KEY_DETAILS:([\w-]+)$/, this.onKeyDetails);
    this.bot.action('BTN_BALANCE', this.onBalance);
    this.bot.action('ADD_BALANCE', this.onAddBalance);
    this.bot.action('ON_ADD_BALANCE_INSTRUCTION', this.onAddBalanceInstruction);
    this.bot.action('ON_ADD_KEY_INSTRUCTION', this.onAddKeyInstruction);
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

    const userInfo = await this.bot.telegram.getMe();
    if (!userInfo.username.includes('test'))
      for (const lang of Object.keys(this.i18nService.langs)) {
        await Promise.all([
          this.bot.telegram.setMyDescription(this.t(lang, 'description'), lang),
          this.bot.telegram.setMyShortDescription(
            this.t(lang, 'short_description'),
            lang,
          ),
        ]);
      }

    void this.bot.launch();
  }

  onModuleDestroy() {
    this.bot.stop();
  }

  private t(ctx: Context | string | undefined, key: string) {
    return this.i18nService.t(
      typeof ctx === 'string' ? ctx : ctx?.from?.language_code,
      key,
    );
  }

  private readonly menu = (ctx: Context | string | undefined) =>
    Markup.inlineKeyboard([
      [Markup.button.callback(`🌐️ ${this.t(ctx, 'menu')}`, 'BTN_1')],
      [
        Markup.button.callback(
          `📖 ${this.t(ctx, 'instruction')}`,
          'ON_INSTRUCTION',
        ),
        Markup.button.url(
          `👩‍💻 ${this.t(ctx, 'support')}`,
          'https://t.me/passimx',
        ),
      ],
      [
        Markup.button.url(
          `📄 ${this.t(ctx, 'user_agreement')}`,
          'https://passimx.ru/info/ru/vpn-user-agreement.html',
        ),
      ],
    ]);

  private readonly backToProfileButton = (lang?: string) =>
    Markup.button.callback(`⬅️ ${this.t(lang, 'back')}`, 'BTN_1');

  private readonly backToPayWaysButton = (lang?: string) =>
    Markup.button.callback(`⬅️ ${this.t(lang, 'back')}`, 'ADD_BALANCE');

  private readonly backToSetAmountButton = (lang?: string) =>
    Markup.button.callback(`⬅️ ${this.t(lang, 'back')}`, 'BTN_BALANCE');

  private readonly backToTariffsButton = (lang?: string) =>
    Markup.button.callback(`⬅️ ${this.t(lang, 'to_the_tariffs')}`, 'BTN_9');

  private readonly downloadLinks = {
    mac: 'https://github.com/amnezia-vpn/amnezia-client/releases/download/4.8.12.9/AmneziaVPN_4.8.12.9_macos.pkg',
    windows:
      'https://github.com/amnezia-vpn/amnezia-client/releases/download/4.8.12.9/AmneziaVPN_4.8.12.9_x64.exe',
    android:
      'https://play.google.com/store/apps/details?id=org.amnezia.vpn&utm_source=amnezia.org&utm_campaign=organic&utm_medium=referral',
    ios: 'https://apps.apple.com/ru/app/defaultvpn/id6744725017',
  };

  onStart = async (ctx: Context) => {
    const filePath = path.join(
      __dirname,
      '../',
      '../',
      'public',
      'media',
      'welcome.mp4',
    );

    const videoMessage = await ctx.replyWithVideo(
      this.welcomeVideoId ?? Input.fromLocalFile(filePath),
      {
        disable_notification: true,
      },
    );
    await ctx.reply(
      `${this.t(ctx, 'welcome')} <b>${this.t(ctx, 'instruction')}</b>\n\n${this.t(ctx, 'select_action')}:`,
      {
        parse_mode: 'HTML',
        ...this.menu(ctx),
      },
    );

    if (!this.welcomeVideoId) {
      console.log(`Set welcomeVideoId = '${videoMessage.video.file_id}'`);
      this.welcomeVideoId = videoMessage.video.file_id;
    }

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
        languageCode: ctx?.from?.language_code,
      });
    }
  };

  onBtn1 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
    const telegramId = ctx?.from?.id;
    const user = await this.em.findOne(UserEntity, {
      where: { telegramId },
    });
    const lang = ctx.from?.language_code;

    if (!user) return;
    this.amountMap.delete(telegramId!);

    await ctx
      .editMessageText(
        `ID: ${user.id}\n${this.t(lang, 'balance')}: ${user.balance} ${this.t(ctx, 'rub')}`,
        Markup.inlineKeyboard([
          [Markup.button.callback(`🔑 ${this.t(ctx, 'my_keys')}`, 'BTN_5')],
          [Markup.button.callback(`🛒 ${this.t(ctx, 'buy_key')}`, 'BTN_9')],
          [
            Markup.button.callback(
              `💸 ${this.t(lang, 'put_money')}`,
              'BTN_BALANCE',
            ),
          ],
          [Markup.button.callback(`⬅️ ${this.t(ctx, 'back')}`, 'BTN_2')],
        ]),
      )
      .catch(() => {});
  };

  onBtn2 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
    await ctx
      .editMessageText(`${this.t(ctx, 'select_action')}:`, this.menu(ctx))
      .catch(() => {});
  };

  onAddKeyInstruction = async (ctx: Context) => {
    const filePath = path.join(
      __dirname,
      '../',
      '../',
      'public',
      'media',
      'add-key.mp4',
    );

    const lang = ctx?.from?.language_code;
    const videoMessage = await ctx.replyWithVideo(
      this.addKeyVideoId ?? Input.fromLocalFile(filePath),
      {
        caption: `${this.t(lang, 'video_instruction')}: ${this.t(lang, 'how_to_connect_key')}\n\n${this.t(ctx, 'required_steps')}:\n${this.t(lang, 'menu')} -> ${this.t(lang, 'buy_key')} -> ${this.t(lang, 'select_tariff')} -> ${this.t(lang, 'buy')} -> ${this.t(lang, 'copy_key')} -> ${this.t(lang, 'open_download_app')} -> ${this.t(lang, 'insert_key')} -> ${this.t(lang, 'connect_vpn')}`,
        width: 720,
        height: 1280,
        supports_streaming: true,
        disable_notification: true,
      },
    );

    if (!this.addKeyVideoId) {
      console.log(`Set addKeyVideoId = '${videoMessage.video.file_id}'`);
      this.addKeyVideoId = videoMessage.video.file_id;
    }

    await ctx
      .reply(`${this.t(ctx, 'select_action')}:`, this.menu(ctx))
      .catch(() => {});
  };

  onAddBalanceInstruction = async (ctx: Context) => {
    const filePath = path.join(
      __dirname,
      '../',
      '../',
      'public',
      'media',
      'add-balance.mp4',
    );

    const videoMessage = await ctx.replyWithVideo(
      this.addBalanceVideoId ?? Input.fromLocalFile(filePath),
      {
        caption: `${this.t(ctx, 'video_instruction')}: ${this.t(ctx, 'how_to_put_money')}\n\n${this.t(ctx, 'required_steps')}:\n${this.t(ctx, 'menu')} -> ${this.t(ctx, 'put_money')} -> ${this.t(ctx, 'enter_amount')} -> ${this.t(ctx, 'select_payment_method')} -> ${this.t(ctx, 'payment')}`,
        width: 720,
        height: 1280,
        supports_streaming: true,
        disable_notification: true,
      },
    );

    if (!this.addBalanceVideoId) {
      console.log(`Set addBalanceVideoId = '${videoMessage.video.file_id}'`);
      this.addBalanceVideoId = videoMessage.video.file_id;
    }

    await ctx
      .reply(`${this.t(ctx, 'select_action')}:`, this.menu(ctx))
      .catch(() => {});
  };

  onInstruction = async (ctx: Context) => {
    await ctx.answerCbQuery().catch(() => {});
    await ctx
      .editMessageText(`${this.t(ctx, 'select_action')}:`, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              `💸 ${this.t(ctx, 'how_to_put_money')}`,
              `ON_ADD_BALANCE_INSTRUCTION`,
            ),
          ],
          [
            Markup.button.callback(
              `🔐 ${this.t(ctx, 'how_to_connect_key')}`,
              `ON_ADD_KEY_INSTRUCTION`,
            ),
          ],
          [Markup.button.callback(`📲 ${this.t(ctx, 'app_links')}`, `BTN_4`)],
          [Markup.button.callback(`⬅️ ${this.t(ctx, 'back')}`, 'BTN_2')],
        ]),
      })
      .catch(() => {});
  };

  onBtn4 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
    const instructionText = `📲 <b>${this.t(ctx, 'app_links')}:</b>`;
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
          [
            Markup.button.callback(
              `⬅️ ${this.t(ctx, 'back')}`,
              'ON_INSTRUCTION',
            ),
          ],
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
      relations: ['tariff', 'server'],
      order: { createdAt: 'DESC' },
      take: 10,
    });

    if (!keys.length) {
      return ctx
        .editMessageText(`${this.t(ctx, 'no_active_keys')}.`, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [this.backToProfileButton(ctx.from?.language_code)],
          ]),
        })
        .catch(console.log);
    }

    const keyRows = keys.map(({ id, expiresAt, status, server }, index) => {
      const expires = new Date(expiresAt).toLocaleDateString('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });

      const labelParts = [
        `${index + 1}) [${this.t(ctx, `${server.code}_name`)}]`,
        this.t(ctx, status),
        `${this.t(ctx, 'until')}: ${expires}`,
      ];

      return [
        Markup.button.callback(labelParts.join(' • '), `KEY_DETAILS:${id}`),
      ];
    });

    await ctx
      .editMessageText(`<b>🔑 ${this.t(ctx, 'my_keys')}</b>\n\n`, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          ...keyRows,
          [this.backToProfileButton(ctx.from?.language_code)],
        ]),
      })
      .catch(console.log);
    return;
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
      .editMessageText(
        `💳 <b>${this.t(ctx, 'enter_amount')} (${this.t(ctx, 'rub')})</b>:`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback(
                `50 ${this.t(ctx, 'rub')}`,
                `BUTTON_MONEY:50`,
              ),
              Markup.button.callback(
                `100 ${this.t(ctx, 'rub')}`,
                `BUTTON_MONEY:100`,
              ),
            ],
            [
              Markup.button.callback(
                `300 ${this.t(ctx, 'rub')}`,
                `BUTTON_MONEY:300`,
              ),
              Markup.button.callback(
                `500 ${this.t(ctx, 'rub')}`,
                `BUTTON_MONEY:500`,
              ),
            ],
            [this.backToProfileButton(ctx.from?.language_code)],
          ]),
        },
      )
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
        ? this.t(ctx, 'unlimited')
        : `${tariff.trafficGb} GB`;
    const text =
      `📦 <b>${tariff.name}</b>\n\n` +
      `📊 ${this.t(ctx, 'traffic')}: ${trafficText}\n` +
      `📅 ${this.t(ctx, 'term')}: ${tariff.expirationDays} ${this.t(ctx, 'days')}\n` +
      `💰 ${this.t(ctx, 'price')}: ${tariff.price} ${this.t(ctx, 'rub')}\n`;

    await ctx
      .editMessageText(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              `✅ ${this.t(ctx, 'buy')}`,
              opts.buyCallback,
            ),
            Markup.button.callback(
              `🎟 ${this.t(ctx, 'promo')}`,
              opts.promoCallback,
            ),
          ],
          [
            Markup.button.callback(
              `⬅️ ${this.t(ctx, 'back')}`,
              opts.backCallback,
            ),
          ],
        ]),
      })
      .catch(() => {});
  }

  private async askPromoCode(
    ctx: Context,
    backCallback: string,
  ): Promise<void> {
    await ctx
      .editMessageText(`🎟 ${this.t(ctx, 'enter_promo')}:`, {
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`⬅️ ${this.t(ctx, 'back')}`, backCallback)],
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
        `⬇️ <b>${this.t(ctx, 'payment_inf')}</b>\n` +
          `${this.t(ctx, 'click_for_the_copy')}` +
          `${this.t(ctx, 'wallet_address')}: <code>${Envs.crypto.ton.walletAddress}</code>\n` +
          `${this.t(ctx, 'amount')}: <code>${amount / 1e9}</code> TON\n` +
          `${this.t(ctx, 'allowed_jettons')}: <b>TON</b>, <b>USDT</b>\n` +
          `${this.t(ctx, 'comment')}: <code>${user.id}</code>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback(
                `TON (${this.t(ctx, 'selected')})`,
                `BTN_8`,
              ),
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
            [this.backToPayWaysButton(ctx.from?.language_code)],
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
        `⬇️ <b>${this.t(ctx, 'payment_inf')}</b>\n` +
          `${this.t(ctx, 'click_for_the_copy')}` +
          `${this.t(ctx, 'wallet_address')}: <code>${Envs.crypto.ton.walletAddress}</code>\n` +
          `${this.t(ctx, 'amount')}: <code>${amount / 1e6}</code> USDT\n` +
          `${this.t(ctx, 'allowed_jettons')}: <b>TON</b>, <b>USDT</b>\n` +
          `${this.t(ctx, 'comment')}: <code>${user.id}</code>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('TON', `BTN_8`),
              Markup.button.callback(
                `USDT (${this.t(ctx, 'selected')})`,
                `BTN_11`,
              ),
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
            [this.backToPayWaysButton(ctx.from?.language_code)],
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
      order: { price: 'ASC' },
    });

    if (!tariffs.length) {
      await ctx
        .editMessageText(
          `${this.t(ctx, 'active_tariffs_not_found')}.`,
          Markup.inlineKeyboard([
            [this.backToProfileButton(ctx.from?.language_code)],
          ]),
        )
        .catch(() => {});
      return;
    }

    const tariffButtons = tariffs.map((t) => [
      Markup.button.callback(
        `${t.name} — ${t.price} ${this.t(ctx, 'rub')}`,
        `T:${t.id}`,
      ),
    ]);

    await ctx
      .editMessageText(
        `${this.t(ctx, 'balance')}: ${user.balance} ${this.t(ctx, 'rub')}\n<b>${this.t(ctx, 'select_tariff')}:</b>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            ...tariffButtons,
            [this.backToProfileButton(ctx.from?.language_code)],
          ]),
        },
      )
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
      await ctx
        .answerCbQuery(`${this.t(ctx, 'tariff_not_found')}.`)
        .catch(() => {});
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
    backButton: ReturnType<typeof Markup.button.callback>,
  ): Promise<void> {
    const text =
      `✅ <b>${this.t(ctx, 'key_created')}</b>\n\n` +
      `<b>📋 ${this.t(ctx, 'click_to_copy_key')}:</b>\n` +
      `<code>${uri}</code>\n\n` +
      `${this.t(ctx, 'instruction_how_to_use_key')}.`;

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
          [
            Markup.button.callback(
              `🛒 ${this.t(ctx, 'one_key_more')}`,
              'BTN_9',
            ),
            backButton,
          ],
        ] as unknown as Parameters<typeof Markup.inlineKeyboard>[0]),
      })
      .catch(() => {});
  }

  onBuyTariff = async (ctx: Context) => {
    const callbackData = (ctx.callbackQuery as { data?: string })?.data ?? '';
    const isRenew = callbackData.startsWith('BUY_KEY:');
    /*
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
            [Markup.button.callback(`⬅️ ${this.tctx.from?.language_code, 'back}`, `T:${tariffId}`)],
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
      //  default Xray
      id = callbackData.replace(/^(BUY|BUY_KEY):/, '');
      protocol = 'xray';
    }
    const telegramId = ctx?.from?.id;
    const user = await this.getUserByCtx(ctx);
    if (!user) {
      await ctx
        .answerCbQuery(`${this.t(ctx, 'click_start')} /start`)
        .catch(() => {});
      return;
    }

    await ctx.answerCbQuery(this.t(ctx, 'processing')).catch(() => {});

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
              [
                Markup.button.callback(
                  `💸 ${this.t(ctx, 'put_money')}`,
                  'BTN_BALANCE',
                ),
              ],
              [Markup.button.callback(`⬅️ ${this.t(ctx, 'back')}`, 'BTN_5')],
            ]),
          })
          .catch(() => {});
        return;
      }

      await ctx
        .editMessageText(`✅ ${this.t(ctx, 'extended_key')}`, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(`🔑 ${this.t(ctx, 'my_keys')}`, 'BTN_5')],
            [this.backToProfileButton(ctx.from?.language_code)],
          ]),
        })
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
              [
                Markup.button.callback(
                  `💸 ${this.t(ctx, 'put_money')}`,
                  'BTN_BALANCE',
                ),
              ],
              [Markup.button.callback(`⬅️ ${this.t(ctx, 'back')}`, 'BTN_9')],
            ]),
          })
          .catch(() => {});
        return;
      }

      await this.showKeyCreatedScreen(
        ctx,
        result.uri,
        this.backToProfileButton(ctx.from?.language_code),
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
      await ctx.answerCbQuery(this.t(ctx, 'key_not_found')).catch(() => {});
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

  onMigrateServer = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});

    const keyId = (
      (ctx.callbackQuery as { data?: string })?.data ?? ''
    ).replace('MIGRATE_SERVER:', '');

    const user = await this.getUserByCtx(ctx);
    if (!user) return;

    const servers = await this.em.find(ServerEntity, {
      where: { status: 'active' },
    });

    const kb = Markup.inlineKeyboard([
      ...servers.map((server) => [
        Markup.button.callback(
          `${this.t(ctx, `${server.code}_flag`)} ${this.t(ctx, `${server.code}_name`)}`,
          `MIGRATE_SERVER_COUNTRY:${keyId}:${server.code}`,
        ),
      ]),
      [this.backToProfileButton(ctx.from?.language_code)],
    ]);

    await ctx
      .editMessageText(`${this.t(ctx, 'select_country')}:`, kb)
      .catch(() => ctx.reply(`${this.t(ctx, 'select_country')}:`, kb));
  };

  onMigrateServerCountry = async (ctx: Context) => {
    const [, keyId, code] = (
      (ctx.callbackQuery as { data?: string })?.data ?? ''
    ).split(':');
    const user = await this.getUserByCtx(ctx);
    if (!user) return ctx.answerCbQuery().catch(() => {});
    const vpnKey = await this.em.findOne(UserKeyEntity, {
      where: { id: keyId, userId: user.id, protocol: 'xray', status: 'active' },
      relations: ['server'],
    });

    if (!vpnKey?.server) {
      return ctx.answerCbQuery(this.t(ctx, 'key_not_found')).catch(() => {});
    }
    await ctx.answerCbQuery(this.t(ctx, 'processing')).catch(() => {});
    const newUri = await this.amneziaService.migrateXrayKeyToAnotherServer(
      vpnKey.id,
      code,
    );
    if (!newUri) {
      return ctx
        .editMessageText(`❌ ${this.t(ctx, 'error_try_again_later')}`, {
          ...Markup.inlineKeyboard([
            [Markup.button.callback(`🔑 ${this.t(ctx, 'my_keys')}`, 'BTN_5')],
            [this.backToProfileButton(ctx.from?.language_code)],
          ]),
        })
        .catch(() => {});
    }

    await this.showKeyCreatedScreen(
      ctx,
      newUri,
      this.backToProfileButton(ctx.from?.language_code),
    );
  };

  onKeyDetails = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
    const data = (ctx.callbackQuery as { data?: string })?.data ?? '';
    const keyId = data.replace('KEY_DETAILS:', '');

    const user = await this.getUserByCtx(ctx);
    if (!user) return;

    const vpnKey = await this.em.findOne(UserKeyEntity, {
      where: { id: keyId, userId: user.id },
      relations: ['tariff', 'server'],
    });
    if (!vpnKey) {
      await ctx.answerCbQuery(this.t(ctx, 'key_not_found')).catch(() => {});
      return;
    }

    const created =
      vpnKey.createdAt &&
      new Date(vpnKey.createdAt).toLocaleDateString('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    const expires =
      vpnKey.expiresAt &&
      new Date(vpnKey.expiresAt).toLocaleDateString('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });

    const lines = [
      `🔑 <b>${this.t(ctx, 'my_keys')}</b>`,
      '',
      `Протокол: <b>${vpnKey.protocol}</b>`,
      `${this.t(ctx, 'status')}: ${this.t(ctx, vpnKey.status)}`,
      created ? `${this.t(ctx, 'start_date')}: ${created}` : '',
      expires ? `${this.t(ctx, 'until')}: ${expires}` : '',
      `${this.t(ctx, 'country')}: ${this.t(ctx, `${vpnKey.server.code}_name`)}`,
      '',
      `${this.t(ctx, 'key')}:`,
      `<code>${vpnKey.key}</code>`,
    ].filter(Boolean);

    const buttons: ReturnType<typeof Markup.button.callback>[][] = [];

    if (vpnKey.tariff?.id !== Envs.telegram.trialTariffId) {
      buttons.push([
        Markup.button.callback(
          `🔄 ${this.t(ctx, 'extend_key')}`,
          `RENEW:${vpnKey.id}`,
        ),
      ]);
    }

    if (vpnKey.protocol === 'xray' && vpnKey.status === 'active') {
      buttons.push([
        Markup.button.callback(
          `🌍 ${this.t(ctx, 'change_server')}`,
          `MIGRATE_SERVER:${vpnKey.id}`,
        ),
      ]);
    }

    buttons.push([this.backToProfileButton(ctx.from?.language_code)]);

    await ctx
      .editMessageText(lines.join('\n'), {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons),
      })
      .catch(() => {});
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
        await ctx.reply(`❌ ${this.t(ctx, 'key_not_found')}`).catch(() => {});
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
            [Markup.button.callback(`⬅️ ${this.t(ctx, 'back')}`, backCallback)],
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
          `✅ ${this.t(ctx, 'promo_activated')}. ${this.t(ctx, 'price')}: <b>${priceResult.finalPrice} ${this.t(ctx, 'rub')}</b>\n${this.t(ctx, 'click')} ${this.t(ctx, 'buy')}:`,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  `✅ ${this.t(ctx, 'buy')}`,
                  `BUY_KEY:${id}`,
                ),
              ],
              [Markup.button.callback(`⬅️ ${this.t(ctx, 'to_keys')}`, 'BTN_5')],
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
          `✅ ${this.t(ctx, 'promo_activated')}. ${this.t(ctx, 'price')}: <b>${priceResult.finalPrice} ${this.t(ctx, 'rub')}</b>\n${this.t(ctx, 'click')} ${this.t(ctx, 'buy')}:`,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  `✅ ${this.t(ctx, 'buy')}`,
                  `BUY:${tariffId}`,
                ),
              ],
              [this.backToTariffsButton(ctx.from?.language_code)],
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
      await ctx
        .reply(`❌ ${this.t(ctx, 'enter_correct_number')}`)
        .catch(() => {});
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
      `${this.t(user.languageCode, 'improve_balance')} <b>${Math.ceil(balance)} ${this.t(user.languageCode, 'rub')}</b>`,
      { parse_mode: 'HTML' },
    );
    await this.bot.telegram.sendMessage(
      user.chatId,
      `${this.t(user.languageCode, 'select_action')}:`,
      this.menu(user.languageCode),
    );
  }

  public async send8MarchMessage(user: UserEntity) {
    if (!user.chatId) return;
    const filePath = path.join(
      __dirname,
      '../',
      '../',
      'public',
      'media',
      '8march.jpeg',
    );

    await this.bot.telegram.sendPhoto(
      user.chatId,
      Input.fromLocalFile(filePath),
      {
        caption: this.t(user.languageCode, 'message_8_march'),
        parse_mode: 'HTML',
      },
    );
    await this.bot.telegram.sendMessage(user.chatId, '<b>MARCH8</b>', {
      parse_mode: 'HTML',
    });
    await this.bot.telegram.sendMessage(
      user.chatId,
      `${this.t(user.languageCode, 'select_action')}:`,
      {
        ...this.menu(user.languageCode),
      },
    );
  }

  public async sendRequestToBuyKey(user: UserEntity) {
    if (!user.chatId) return;

    const filePath = path.join(
      __dirname,
      '../',
      '../',
      'public',
      'media',
      'welcome.mp4',
    );

    const videoMessage = await this.bot.telegram.sendVideo(
      user.chatId,
      this.welcomeVideoId ?? Input.fromLocalFile(filePath),
      {
        disable_notification: true,
      },
    );
    if (!this.welcomeVideoId) {
      console.log(`Set welcomeVideoId = '${videoMessage.video.file_id}'`);
      this.welcomeVideoId = videoMessage.video.file_id;
    }

    await this.bot.telegram.sendMessage(
      user.chatId,
      this.t(user.languageCode, 'message_try_first_key'),
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              `⬅️ ${this.t(user.languageCode, 'to_the_tariffs')}`,
              'BTN_9',
            ),
          ],
          [
            Markup.button.callback(
              `📖 ${this.t(user.languageCode, 'instruction')}`,
              'ON_INSTRUCTION',
            ),
          ],
          [
            Markup.button.url(
              `👩‍💻 ${this.t(user.languageCode, 'support')}`,
              'https://t.me/passimx',
            ),
          ],
        ]),
      },
    );
  }

  public async sendAlmostExpiredKey(user: UserEntity) {
    if (!user.chatId) return;

    await this.bot.telegram.sendMessage(
      user.chatId,
      `${this.t(user.languageCode, 'key_almost_expired')}: ${user.balance}`,
      Markup.inlineKeyboard([
        ...user.keys
          .filter((key) => key.tariff?.id !== Envs.telegram.trialTariffId)
          .map((key, index) => [
            Markup.button.callback(
              `🔄 ${this.t(user.languageCode, 'extend_key')} ${index + 1}`,
              `RENEW:${key.id}`,
            ),
          ]),
        [this.backToProfileButton(user.languageCode)],
      ]),
    );
  }

  public async replyUsersWithoutKeys() {
    const users = await this.em
      .createQueryBuilder(UserEntity, 'users')
      .leftJoin('users.keys', 'keys')
      .groupBy('users.id')
      .having('COUNT(keys.id) = 0')
      .getMany();

    await Promise.all(
      users.map(async (user) => this.sendRequestToBuyKey(user)),
    );
  }

  // public async send8March() {
  //   const users = await this.em
  //     .createQueryBuilder(UserEntity, 'users')
  //     .leftJoin('users.keys', 'keys')
  //     .groupBy('users.id')
  //     .having('COUNT(keys.id) = 0')
  //     .getMany();
  //
  //   await Promise.all(users.map(async (user) => this.send8MarchMessage(user)));
  // }

  private getPayloadForAddBalance = async (user: UserEntity) => {
    const amount = this.amountMap.get(user.telegramId);
    if (!amount) return;
    const result = await this.yookassaBalanceService.createBalancePaymentLink(
      user.id,
      amount,
    );
    const text: string =
      `${this.t(user.languageCode, 'deposit_amount')}: ${amount} ${this.t(user.languageCode, 'rub')}\n` +
      `${this.t(user.languageCode, 'select_payment_method')}:`;
    const extra = Markup.inlineKeyboard([
      result.ok
        ? [
            Markup.button.callback(
              `💎 ${this.t(user.languageCode, 'ton')} (+${Envs.crypto.allowance * 100}%)`,
              'BTN_8',
            ),
            Markup.button.url('💳 YooKassa', result.paymentUrl),
          ]
        : [
            Markup.button.callback(
              `💎 ${this.t(user.languageCode, 'ton')} (+${Envs.crypto.allowance * 100}%)`,
              'BTN_8',
            ),
          ],
      [this.backToSetAmountButton(user.languageCode)],
    ]);

    return { text, extra };
  };
}
