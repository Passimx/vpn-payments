import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Context, Input, Markup, Telegraf } from 'telegraf';

import { EntityManager, MoreThanOrEqual, Not } from 'typeorm';
import { UserEntity } from '../database/entities/user.entity';
import { TariffEntity } from '../database/entities/tariff.entity';
import { UserKeyEntity } from '../database/entities/user-key.entity';
import { Envs } from '../../common/env/envs';
import { KeyPurchaseService } from '../key-purchase/key-purchase.service';
import { YookassaBalanceService } from '../yookassa/yookassa-balance.service';
import { TransactionsService } from '../transactions/transactions.service';
import path from 'node:path';
import { I18nService } from '../i18n/i18n.service';
import { XrayService } from '../xray/xray-service';
import { ServerEntity } from '../database/entities/server.entity';
import { AnalyticsService } from './analytics.service';
import { Archiver } from '@passimx/archiver';
import { logger } from '../../common/logger/logger';
import { WechatService } from '../wechat/wechat.service';

@Injectable()
export class TelegramService {
  public bot: Telegraf;

  private amountMap = new Map<number, number>();
  private addKeyVideoId = Envs.telegram.addKeyVideoId;
  private addBalanceVideoId = Envs.telegram.addBalanceVideoId;
  private welcomeVideoId = Envs.telegram.welcomeVideoId;
  private changeVideoId = Envs.telegram.changeVideoId;
  private waitingForPromo = new Map<number, { id: string; isRenew: boolean }>();
  private pendingPromo = new Map<
    number,
    { id: string; promoCode: string; isRenew: boolean }
  >();
  // Продление: выбранный ключ и тариф
  private pendingRenewKeyId = new Map<number, string>();
  private pendingRenewTariffId = new Map<number, string>();

  constructor(
    private readonly em: EntityManager,
    private readonly keyPurchaseService: KeyPurchaseService,
    private readonly transactionsService: TransactionsService,
    private readonly yookassaBalanceService: YookassaBalanceService,
    @Inject(forwardRef(() => AnalyticsService))
    private readonly analyticsService: AnalyticsService,
    private readonly i18nService: I18nService,
    @Inject(forwardRef(() => XrayService))
    private readonly xrayService: XrayService,
    private readonly wechatService: WechatService,
  ) {}

  async onModuleInit() {
    this.bot = new Telegraf(Envs.telegram.botToken);
    this.bot.catch(logger.error);

    const archiver = new Archiver({
      apiKey: Envs.telegram.archiverApiKey,
      endpoint: Envs.telegram.archiverEndpoint,
    });
    archiver.listen(this.bot);

    this.bot.command('stats', this.analyticsService.sendAnalytics);
    this.bot.start(this.onStart);
    this.bot.action('BTN_1', this.onBtn1);
    this.bot.action('BTN_2', this.onBtn2);
    this.bot.action('ON_INSTRUCTION', this.onInstruction);
    this.bot.action('BTN_4', this.onBtn4);
    this.bot.action('BTN_5', this.onBtn5);
    this.bot.action('BTN_8', this.onBtn8);
    this.bot.action('BTN_9', this.onBtn9);
    this.bot.action('BTN_11', this.onBtn11);
    this.bot.action(/^MIGRATE_SERVER:([\w-]+)$/, this.onMigrateServer);
    this.bot.action(/^MIGRATE_SERVER_COUNTRY:.+$/, this.onMigrateServerCountry);
    this.bot.action(/^KEY_DETAILS:([\w-]+)$/, this.onKeyDetails);
    this.bot.action('BTN_BALANCE', this.onBalance);
    this.bot.action('ADD_BALANCE', this.onAddBalance);
    this.bot.action('ON_ADD_BALANCE_INSTRUCTION', this.onAddBalanceInstruction);
    this.bot.action('ON_ADD_KEY_INSTRUCTION', this.onAddKeyInstruction);
    this.bot.action('ON_WECHAT', this.onWechat);
    this.bot.action('ON_YOOKASSA', this.onYookassa);
    this.bot.action('ON_LANGUAGE', this.onLanguage);
    this.bot.action(/^ON_SET_LANGUAGE:[\w-]+$/, this.onSetLanguage);
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

  private t(ctx: UserEntity | string, key: string) {
    let lang = 'en';

    if (typeof ctx === 'string') lang = ctx;
    else if (ctx.languageCode) lang = ctx.languageCode;

    return this.i18nService.t(lang, key);
  }

  private menu = (ctx: UserEntity) =>
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
        Markup.button.callback(
          `🌏 ${this.t(ctx, 'change_language')}`,
          'ON_LANGUAGE',
        ),
      ],
      [
        Markup.button.url(
          `📄 ${this.t(ctx, 'user_agreement')}`,
          'https://passimx.ru/info/ru/vpn-user-agreement.html',
        ),
      ],
    ]);

  private backToProfileButton = (user: UserEntity) =>
    Markup.button.callback(`⬅️ ${this.t(user, 'back')}`, 'BTN_1');

  private backToPayWaysButton = (user: UserEntity) =>
    Markup.button.callback(`⬅️ ${this.t(user, 'back')}`, 'ADD_BALANCE');

  private backToSetAmountButton = (user: UserEntity) =>
    Markup.button.callback(`⬅️ ${this.t(user, 'back')}`, 'BTN_BALANCE');

  private backToTariffsButton = (user: UserEntity) =>
    Markup.button.callback(`⬅️ ${this.t(user, 'to_the_tariffs')}`, 'BTN_9');

  private readonly downloadLinks = {
    mac: 'https://github.com/amnezia-vpn/amnezia-client/releases/download/4.8.12.9/AmneziaVPN_4.8.12.9_macos.pkg',
    windows:
      'https://github.com/amnezia-vpn/amnezia-client/releases/download/4.8.12.9/AmneziaVPN_4.8.12.9_x64.exe',
    android:
      'https://play.google.com/store/apps/details?id=org.amnezia.vpn&utm_source=amnezia.org&utm_campaign=organic&utm_medium=referral',
    ios: 'https://apps.apple.com/ru/app/defaultvpn/id6744725017',
  };

  onStart = async (ctx: Context) => {
    const user = await this.getUserByCtx(ctx);
    const filePath = path.join(
      __dirname,
      '../',
      '../',
      'public',
      'media',
      'welcome.mp4',
    );

    const videoMessage = await ctx
      .replyWithVideo(this.welcomeVideoId ?? Input.fromLocalFile(filePath), {
        disable_notification: true,
      })
      .catch(logger.error);
    await ctx
      .reply(
        `${this.t(user, 'welcome')} <b>${this.t(user, 'instruction')}</b>\n\n${this.t(user, 'select_action')}:`,
        {
          parse_mode: 'HTML',
          ...this.menu(user),
        },
      )
      .catch(logger.error);

    if (!videoMessage) return;
    if (!this.welcomeVideoId) {
      logger.info(`Set welcomeVideoId = '${videoMessage.video.file_id}'`);
      this.welcomeVideoId = videoMessage.video.file_id;
    }
  };

  onYookassa = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const user = await this.getUserByCtx(ctx);
    const amount = this.amountMap.get(user.telegramId);
    if (!amount) return;
    const result = await this.yookassaBalanceService.createBalancePaymentLink(
      user.id,
      amount,
    );
    if (!result.ok) {
      await ctx
        .editMessageText(`❌ ${result.error}`, {
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback(
                `💸 ${this.t(user, 'put_money')}`,
                'BTN_BALANCE',
              ),
            ],
            [Markup.button.callback(`⬅️ ${this.t(user, 'back')}`, 'BTN_9')],
          ]),
        })
        .catch(logger.error);
      return;
    }

    await ctx
      .editMessageText(
        `${this.t(user, 'ru_payment_message')}\n${this.t(user, 'deposit_amount')}: ${amount} ${this.t(user, 'rub')}`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.url('💳 YooKassa', result.paymentUrl)],
            [
              Markup.button.callback(
                `⬅️ ${this.t(user, 'back')}`,
                `BUTTON_MONEY:${amount}`,
              ),
            ],
          ]),
        },
      )
      .catch(logger.error);
  };

  onWechat = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);

    const user = await this.getUserByCtx(ctx);
    const amount = this.amountMap.get(user.telegramId);
    const price = await this.transactionsService.getCurrencyPrice();
    if (!amount) return;
    if (!price) return;

    const invoiceQrCode = await this.wechatService.createInvoice({
      outTradeNo: Date.now().toString(),
      amount: amount / (price.usd.rub / price.usd.cny),
      userId: user.id,
    });
    if (!invoiceQrCode) return;

    await ctx
      .sendPhoto(Input.fromBuffer(invoiceQrCode), {
        caption: this.t(user, 'zh_payment_message'),
        parse_mode: 'HTML',
        disable_notification: true,
      })
      .catch(logger.error);
    await ctx
      .sendMessage(`${this.t(user, 'select_action')}:`, {
        ...this.menu(user),
      })
      .catch(logger.error);
  };

  onLanguage = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const user = await this.getUserByCtx(ctx);

    await ctx.editMessageText(
      `${this.t(user, 'select_action')}:`,
      Markup.inlineKeyboard([
        [Markup.button.callback('🇺🇲 English', 'ON_SET_LANGUAGE:en')],
        [Markup.button.callback('🇨🇳 中文', 'ON_SET_LANGUAGE:zh')],
        [Markup.button.callback('🇷🇺 Русский', 'ON_SET_LANGUAGE:ru')],
        [this.backToProfileButton(user)],
      ]),
    );
  };

  onSetLanguage = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const callbackData = (ctx.callbackQuery as { data?: string })?.data ?? '';
    const languageCode = callbackData.replace('ON_SET_LANGUAGE:', '');
    await this.em.update(
      UserEntity,
      { telegramId: ctx.from!.id },
      { languageCode },
    );
    const user = await this.getUserByCtx(ctx);

    await ctx
      .editMessageText(`${this.t(user, 'select_action')}:`, this.menu(user))
      .catch(logger.error);
  };

  onBtn1 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const telegramId = ctx?.from?.id;
    const user = await this.getUserByCtx(ctx);

    this.amountMap.delete(telegramId!);

    await ctx
      .editMessageText(
        `ID: ${user.id}\n${this.t(user, 'balance')}: ${user.balance} ${this.t(user, 'rub')}`,
        Markup.inlineKeyboard([
          [Markup.button.callback(`🔑 ${this.t(user, 'my_keys')}`, 'BTN_5')],
          [Markup.button.callback(`🛒 ${this.t(user, 'buy_key')}`, 'BTN_9')],
          [
            Markup.button.callback(
              `💸 ${this.t(user, 'put_money')}`,
              'BTN_BALANCE',
            ),
          ],
          [Markup.button.callback(`⬅️ ${this.t(user, 'back')}`, 'BTN_2')],
        ]),
      )
      .catch(logger.error);
  };

  onBtn2 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const user = await this.getUserByCtx(ctx);
    await ctx
      .editMessageText(`${this.t(user, 'select_action')}:`, this.menu(user))
      .catch(logger.error);
  };

  onAddKeyInstruction = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const filePath = path.join(
      __dirname,
      '../',
      '../',
      'public',
      'media',
      'add-key.mp4',
    );
    const user = await this.getUserByCtx(ctx);

    const videoMessage = await ctx
      .replyWithVideo(this.addKeyVideoId ?? Input.fromLocalFile(filePath), {
        caption: `${this.t(user, 'video_instruction')}: ${this.t(user, 'how_to_connect_key')}\n\n${this.t(user, 'required_steps')}:\n${this.t(user, 'menu')} -> ${this.t(user, 'buy_key')} -> ${this.t(user, 'select_tariff')} -> ${this.t(user, 'buy')} -> ${this.t(user, 'copy_key')} -> ${this.t(user, 'open_download_app')} -> ${this.t(user, 'insert_key')} -> ${this.t(user, 'connect_vpn')}`,
        width: 720,
        height: 1280,
        supports_streaming: true,
        disable_notification: true,
      })
      .catch(logger.error);

    if (!videoMessage) return;
    if (!this.addKeyVideoId) {
      logger.info(`Set addKeyVideoId = '${videoMessage.video.file_id}'`);
      this.addKeyVideoId = videoMessage.video.file_id;
    }

    await ctx
      .reply(`${this.t(user, 'select_action')}:`, this.menu(user))
      .catch(logger.error);
  };

  onAddBalanceInstruction = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const user = await this.getUserByCtx(ctx);
    const filePath = path.join(
      __dirname,
      '../',
      '../',
      'public',
      'media',
      'add-balance.mp4',
    );

    const videoMessage = await ctx
      .replyWithVideo(this.addBalanceVideoId ?? Input.fromLocalFile(filePath), {
        caption: `${this.t(user, 'video_instruction')}: ${this.t(user, 'how_to_put_money')}\n\n${this.t(user, 'required_steps')}:\n${this.t(user, 'menu')} -> ${this.t(user, 'put_money')} -> ${this.t(user, 'enter_amount')} -> ${this.t(user, 'select_payment_method')} -> ${this.t(user, 'payment')}`,
        width: 720,
        height: 1280,
        supports_streaming: true,
        disable_notification: true,
      })
      .catch(logger.error);

    if (!videoMessage) return;
    if (!this.addBalanceVideoId) {
      logger.info(`Set addBalanceVideoId = '${videoMessage.video.file_id}'`);
      this.addBalanceVideoId = videoMessage.video.file_id;
    }

    await ctx
      .reply(`${this.t(user, 'select_action')}:`, this.menu(user))
      .catch(logger.error);
  };

  onInstruction = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const user = await this.getUserByCtx(ctx);
    await ctx
      .editMessageText(`${this.t(user, 'select_action')}:`, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              `💸 ${this.t(user, 'how_to_put_money')}`,
              `ON_ADD_BALANCE_INSTRUCTION`,
            ),
          ],
          [
            Markup.button.callback(
              `🔐 ${this.t(user, 'how_to_connect_key')}`,
              `ON_ADD_KEY_INSTRUCTION`,
            ),
          ],
          [Markup.button.callback(`📲 ${this.t(user, 'app_links')}`, `BTN_4`)],
          [Markup.button.callback(`⬅️ ${this.t(user, 'back')}`, 'BTN_2')],
        ]),
      })
      .catch(logger.error);
  };

  onBtn4 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const user = await this.getUserByCtx(ctx);
    const instructionText = `📲 <b>${this.t(user, 'app_links')}:</b>`;
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
              `⬅️ ${this.t(user, 'back')}`,
              'ON_INSTRUCTION',
            ),
          ],
        ]),
      })
      .catch(logger.error);
  };

  onBtn5 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const telegramId = ctx?.from?.id;
    if (telegramId) {
      this.pendingRenewKeyId.delete(telegramId);
      this.pendingRenewTariffId.delete(telegramId);
    }
    const user = await this.getUserByCtx(ctx);

    const keys = await this.em.find(UserKeyEntity, {
      where: { userId: user.id },
      relations: ['tariff', 'server'],
      order: { createdAt: 'DESC' },
    });

    if (!keys.length) {
      return ctx
        .editMessageText(`${this.t(user, 'no_active_keys')}.`, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(`🛒 ${this.t(user, 'buy_key')}`, 'BTN_9')],
            [this.backToProfileButton(user)],
          ]),
        })
        .catch(logger.error);
    }

    const keyRows = this.prepareKeysToButtons(user, keys);

    await ctx
      .editMessageText(`<b>🔑 ${this.t(user, 'my_keys')}</b>\n\n`, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          ...keyRows,
          [this.backToProfileButton(user)],
        ]),
      })
      .catch(logger.error);
    return;
  };

  onSetButtonMoney = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const user = await this.getUserByCtx(ctx);
    const callbackData = (ctx.callbackQuery as { data?: string })?.data ?? '';
    const amount = Number(callbackData.replace(/^(BUTTON_MONEY):/, ''));
    this.amountMap.set(user.telegramId, amount);
    const payload = this.getPayloadForAddBalance(user);
    if (!payload) return;
    await ctx.editMessageText(payload.text, payload.extra);
  };

  onBalance = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const user = await this.getUserByCtx(ctx);
    this.amountMap.set(user.telegramId, 0);
    await ctx
      .editMessageText(
        `💳 <b>${this.t(user, 'enter_amount')} (${this.t(user, 'rub')})</b>:`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback(
                `100 ${this.t(user, 'rub')}`,
                `BUTTON_MONEY:100`,
              ),
              Markup.button.callback(
                `200 ${this.t(user, 'rub')}`,
                `BUTTON_MONEY:200`,
              ),
            ],
            [
              Markup.button.callback(
                `300 ${this.t(user, 'rub')}`,
                `BUTTON_MONEY:300`,
              ),
              Markup.button.callback(
                `1000 ${this.t(user, 'rub')}`,
                `BUTTON_MONEY:1000`,
              ),
            ],
            [this.backToProfileButton(user)],
          ]),
        },
      )
      .catch(logger.error);
  };

  private async getUserByCtx(ctx: Context) {
    const user = await this.em.findOne(UserEntity, {
      where: { telegramId: ctx?.from!.id },
    });
    if (user) return user;

    const id = crypto.randomUUID().replace(/-/g, '');
    await this.em.insert(UserEntity, {
      id,
      telegramId: ctx?.from!.id,
      chatId: ctx?.chat?.id,
      userName: ctx?.from!.username,
      languageCode: ctx?.from!.language_code,
    });
    return this.em.findOneOrFail(UserEntity, {
      where: { telegramId: ctx?.from!.id },
    });
  }

  // Общий список тарифов (покупка и продление)
  private async showActiveTariffsList(
    ctx: Context,
    user: UserEntity,
    backButtonRow: ReturnType<typeof Markup.button.callback>[],
  ): Promise<void> {
    const tariffButtons = await this.tariffsButtons(user);
    if (!tariffButtons.length) {
      await ctx
        .editMessageText(
          `${this.t(user, 'active_tariffs_not_found')}.`,
          Markup.inlineKeyboard([backButtonRow]),
        )
        .catch(logger.error);
      return;
    }

    await ctx
      .editMessageText(
        `${this.t(user, 'balance')}: ${user.balance} ${this.t(user, 'rub')}\n<b>${this.t(user, 'select_tariff')}:</b>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([...tariffButtons, backButtonRow]),
        },
      )
      .catch(logger.error);
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
    const user = await this.getUserByCtx(ctx);
    const text =
      `📦 <b>${this.t(user, `tariff_${tariff.expirationDays}`)}</b>\n\n` +
      `📊 ${this.t(user, 'traffic')}: ${this.t(user, 'unlimited')}\n` +
      `📅 ${this.t(user, 'term')}: ${tariff.expirationDays} ${this.t(user, 'days')}\n` +
      `💰 ${this.t(user, 'price')}: ${tariff.price} ${this.t(user, 'rub')}\n`;

    await ctx
      .editMessageText(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              `✅ ${this.t(user, 'buy')}`,
              opts.buyCallback,
            ),
            Markup.button.callback(
              `🎟 ${this.t(user, 'promo')}`,
              opts.promoCallback,
            ),
          ],
          [
            Markup.button.callback(
              `⬅️ ${this.t(user, 'back')}`,
              opts.backCallback,
            ),
          ],
        ]),
      })
      .catch(logger.error);
  }

  private async askPromoCode(
    ctx: Context,
    backCallback: string,
  ): Promise<void> {
    const user = await this.getUserByCtx(ctx);
    await ctx
      .editMessageText(`🎟 ${this.t(user, 'enter_promo')}:`, {
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`⬅️ ${this.t(user, 'back')}`, backCallback)],
        ]),
      })
      .catch(logger.error);
  }

  onBtn8 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const user = await this.getUserByCtx(ctx);
    const amountFromSet = this.amountMap.get(user.telegramId);
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
        `⬇️ <b>${this.t(user, 'payment_inf')}</b>\n` +
          `${this.t(user, 'click_for_the_copy')}` +
          `${this.t(user, 'wallet_address')}: <code>${Envs.crypto.ton.walletAddress}</code>\n` +
          `${this.t(user, 'amount')}: <code>${amount / 1e9}</code> TON\n` +
          `${this.t(user, 'allowed_jettons')}: <b>TON</b>, <b>USDT</b>\n` +
          `${this.t(user, 'comment')}: <code>${user.id}</code>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback(
                `TON (${this.t(user, 'selected')})`,
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
            [this.backToPayWaysButton(user)],
          ]),
        },
      )
      .catch(logger.error);
  };

  onBtn11 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const user = await this.getUserByCtx(ctx);
    const amountFromSet = this.amountMap.get(user.telegramId);
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
        `⬇️ <b>${this.t(user, 'payment_inf')}</b>\n` +
          `${this.t(user, 'click_for_the_copy')}` +
          `${this.t(user, 'wallet_address')}: <code>${Envs.crypto.ton.walletAddress}</code>\n` +
          `${this.t(user, 'amount')}: <code>${amount / 1e6}</code> USDT\n` +
          `${this.t(user, 'allowed_jettons')}: <b>TON</b>, <b>USDT</b>\n` +
          `${this.t(user, 'comment')}: <code>${user.id}</code>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('TON', `BTN_8`),
              Markup.button.callback(
                `USDT (${this.t(user, 'selected')})`,
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
            [this.backToPayWaysButton(user)],
          ]),
        },
      )
      .catch(logger.error);
  };

  onBtn9 = async (ctx: Context) => {
    const telegramId = ctx?.from?.id;
    const user = await this.getUserByCtx(ctx);

    ctx.answerCbQuery().catch(logger.error);
    if (telegramId) {
      this.pendingRenewKeyId.delete(telegramId);
      this.pendingRenewTariffId.delete(telegramId);
    }
    await this.showActiveTariffsList(ctx, user, [
      this.backToProfileButton(user),
    ]);
  };

  onTariffSelect = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const user = await this.getUserByCtx(ctx);
    const telegramId = ctx?.from?.id;
    const renewKeyId = telegramId
      ? this.pendingRenewKeyId.get(telegramId)
      : undefined;
    if (telegramId) {
      this.waitingForPromo.delete(telegramId);
      this.pendingPromo.delete(telegramId);
      if (!renewKeyId) {
        this.pendingRenewKeyId.delete(telegramId);
        this.pendingRenewTariffId.delete(telegramId);
      }
    }
    const callbackData = (ctx.callbackQuery as { data?: string })?.data ?? '';
    const tariffId = callbackData.replace('T:', '');

    const tariff = await this.em.findOne(TariffEntity, {
      where: { id: tariffId, active: true },
    });
    if (!tariff) {
      await ctx
        .answerCbQuery(`${this.t(user, 'tariff_not_found')}.`)
        .catch(logger.error);
      return;
    }

    if (renewKeyId && telegramId) {
      this.pendingRenewTariffId.set(telegramId, tariff.id);
      await this.showTariffScreen(ctx, tariff, {
        buyCallback: `BUY_KEY:${renewKeyId}`,
        promoCallback: `PROMO_KEY:${renewKeyId}`,
        backCallback: `RENEW:${renewKeyId}`,
      });
      return;
    }

    await this.showTariffScreen(ctx, tariff, {
      buyCallback: `BUY:${tariff.id}`,
      promoCallback: `PROMO:${tariff.id}`,
      backCallback: 'BTN_9',
    });
  };

  onPromoClick = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
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
    const user = await this.getUserByCtx(ctx);
    const text =
      `✅ <b>${this.t(user, 'key_created')}</b>\n\n` +
      `<b>📋 ${this.t(user, 'click_to_copy_key')}:</b>\n` +
      `<code>${uri}</code>\n\n` +
      `${this.t(user, 'instruction_how_to_use_key')}.`;

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
              `🛒 ${this.t(user, 'one_key_more')}`,
              'BTN_9',
            ),
            backButton,
          ],
        ] as unknown as Parameters<typeof Markup.inlineKeyboard>[0]),
      })
      .catch(logger.error);
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
              .catch(logger.error);
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

    await ctx.answerCbQuery(this.t(user, 'processing')).catch(logger.error);

    if (isRenew) {
      const promo = telegramId ? this.pendingPromo.get(telegramId) : undefined;
      const promoCode =
        promo?.id === id && promo?.isRenew ? promo.promoCode : undefined;
      if (telegramId && promo?.id === id && promo?.isRenew)
        this.pendingPromo.delete(telegramId);

      let renewTariffId =
        telegramId && this.pendingRenewTariffId.get(telegramId);
      if (!renewTariffId) {
        const vk = await this.em.findOne(UserKeyEntity, {
          where: { id, userId: user.id },
        });
        renewTariffId = vk?.tariffId;
      }
      if (!renewTariffId) {
        await ctx
          .editMessageText(`❌ ${this.t(user, 'tariff_not_found')}`, {
            ...Markup.inlineKeyboard([
              [Markup.button.callback(`⬅️ ${this.t(user, 'back')}`, 'BTN_5')],
            ]),
          })
          .catch(logger.error);
        return;
      }

      const result = await this.keyPurchaseService.renewKey(
        user.id,
        id,
        renewTariffId,
        promoCode,
      );
      if (!result.ok) {
        await ctx
          .editMessageText(`❌ ${result.error}`, {
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  `💸 ${this.t(user, 'put_money')}`,
                  'BTN_BALANCE',
                ),
              ],
              [Markup.button.callback(`⬅️ ${this.t(user, 'back')}`, 'BTN_5')],
            ]),
          })
          .catch(logger.error);
        return;
      }

      if (telegramId) {
        this.pendingRenewKeyId.delete(telegramId);
        this.pendingRenewTariffId.delete(telegramId);
      }

      await ctx
        .editMessageText(`✅ ${this.t(user, 'extended_key')}`, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(`🔑 ${this.t(user, 'my_keys')}`, 'BTN_5')],
            [this.backToProfileButton(user)],
          ]),
        })
        .catch(logger.error);
    } else {
      const promo = telegramId ? this.pendingPromo.get(telegramId) : undefined;
      const promoCode = promo?.promoCode;
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
                  `💸 ${this.t(user, 'put_money')}`,
                  'BTN_BALANCE',
                ),
              ],
              [Markup.button.callback(`⬅️ ${this.t(user, 'back')}`, 'BTN_9')],
            ]),
          })
          .catch(logger.error);
        return;
      }

      await this.showKeyCreatedScreen(
        ctx,
        result.uri,
        this.backToProfileButton(user),
      );
    }
  };

  onRenewKey = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const data = (ctx.callbackQuery as { data?: string })?.data ?? '';
    const keyId = data.replace('RENEW:', '');
    const telegramId = ctx?.from?.id;
    const user = await this.getUserByCtx(ctx);

    const vpnKey = await this.em.findOne(UserKeyEntity, {
      where: { id: keyId, userId: user.id },
      relations: ['tariff'],
    });
    if (!vpnKey || !vpnKey.tariffId || !vpnKey.tariff) {
      await ctx
        .answerCbQuery(this.t(user, 'key_not_found'))
        .catch(logger.error);
      return;
    }

    if (telegramId) {
      this.pendingRenewKeyId.set(telegramId, keyId);
      this.pendingRenewTariffId.delete(telegramId);
    }

    await this.showActiveTariffsList(ctx, user, [
      Markup.button.callback(`⬅️ ${this.t(user, 'back')}`, 'BTN_5'),
    ]);
  };

  onRenewPromo = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const data = (ctx.callbackQuery as { data?: string })?.data ?? '';
    const keyId = data.replace('PROMO_KEY:', '');
    const telegramId = ctx?.from?.id;
    if (!telegramId) return;
    this.waitingForPromo.set(telegramId, { id: keyId, isRenew: true });
    await this.askPromoCode(ctx, `RENEW:${keyId}`);
  };

  onMigrateServer = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const user = await this.getUserByCtx(ctx);
    const keyId = (
      (ctx.callbackQuery as { data?: string })?.data ?? ''
    ).replace('MIGRATE_SERVER:', '');

    await this.getUserByCtx(ctx);

    const key = await this.em.findOneOrFail(UserKeyEntity, {
      where: { id: keyId },
    });

    const servers = await this.em.find(ServerEntity, {
      where: { canCreateKey: true, id: Not(key.serverId) },
    });

    const kb = Markup.inlineKeyboard([
      ...servers.map((server) => [
        Markup.button.callback(
          `${this.t(user, `${server.code}_flag`)} ${this.t(user, `${server.code}_name`)}`,
          `MIGRATE_SERVER_COUNTRY:${keyId}:${server.code}`,
        ),
      ]),

      [this.backToProfileButton(user)],
    ]);

    await ctx
      .editMessageText(`${this.t(user, 'select_country')}:`, kb)
      .catch(logger.error);
  };

  onMigrateServerCountry = async (ctx: Context) => {
    const [, keyId, code] = (
      (ctx.callbackQuery as { data?: string })?.data ?? ''
    ).split(':');
    const user = await this.getUserByCtx(ctx);
    const vpnKey = await this.em.findOne(UserKeyEntity, {
      where: { id: keyId, userId: user.id, protocol: 'xray', status: 'active' },
      relations: ['server'],
    });

    if (!vpnKey?.server) {
      return ctx
        .answerCbQuery(this.t(user, 'key_not_found'))
        .catch(logger.error);
    }
    await ctx.answerCbQuery(this.t(user, 'processing')).catch(logger.error);
    const newUri = await this.xrayService.migrateXrayKeyToAnotherServer(
      vpnKey.id,
      code,
    );
    if (!newUri) {
      return ctx
        .editMessageText(`❌ ${this.t(user, 'error_try_again_later')}`, {
          ...Markup.inlineKeyboard([
            [Markup.button.callback(`🔑 ${this.t(user, 'my_keys')}`, 'BTN_5')],
            [this.backToProfileButton(user)],
          ]),
        })
        .catch(logger.error);
    }

    await this.showKeyCreatedScreen(
      ctx,
      newUri,
      this.backToProfileButton(user),
    );
  };

  onKeyDetails = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const data = (ctx.callbackQuery as { data?: string })?.data ?? '';
    const keyId = data.replace('KEY_DETAILS:', '');

    const user = await this.getUserByCtx(ctx);

    const vpnKey = await this.em.findOne(UserKeyEntity, {
      where: { id: keyId, userId: user.id },
      relations: ['tariff', 'server'],
    });
    if (!vpnKey) {
      await ctx
        .answerCbQuery(this.t(user, 'key_not_found'))
        .catch(logger.error);
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
      `🔑 <b>${this.t(user, 'my_keys')}</b>\n`,
      `<b>ID:</b> ${vpnKey.id}`,
      `<b>${this.t(user, 'status')}:</b> ${this.t(user, vpnKey.status)}`,
      created ? `<b>${this.t(user, 'start_date')}:</b> ${created}` : '',
      expires ? `<b>${this.t(user, 'until')}:</b> ${expires}` : '',
      `<b>${this.t(user, 'country')}:</b> ${this.t(user, `${vpnKey.server.code}_name`)}`,
      `<b>${this.t(user, 'key')}:</b> `,
      `<code>${vpnKey.key}</code>`,
    ].filter(Boolean);

    const buttons: ReturnType<typeof Markup.button.callback>[][] = [];

    buttons.push([
      Markup.button.callback(
        `🔄 ${this.t(user, 'extend_key')}`,
        `RENEW:${vpnKey.id}`,
      ),
    ]);

    if (vpnKey.protocol === 'xray' && vpnKey.status === 'active') {
      buttons.push([
        Markup.button.callback(
          `🌍 ${this.t(user, 'change_server')}`,
          `MIGRATE_SERVER:${vpnKey.id}`,
        ),
      ]);
    }

    buttons.push([this.backToProfileButton(user)]);

    await ctx
      .editMessageText(lines.join('\n'), {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons),
      })
      .catch(logger.error);
  };

  private async handlePromoCode(
    ctx: Context,
    telegramId: number,
    promoText: string,
    isRenew: boolean,
    id: string,
  ): Promise<boolean> {
    const user = await this.getUserByCtx(ctx);

    let tariffId: string;
    if (isRenew) {
      const pendingT = this.pendingRenewTariffId.get(telegramId);
      if (pendingT) {
        tariffId = pendingT;
      } else {
        const vpnKey = await this.em.findOne(UserKeyEntity, {
          where: { id, userId: user.id },
          relations: ['tariff'],
        });
        if (!vpnKey || !vpnKey.tariffId || !vpnKey.tariff) {
          await ctx
            .reply(`❌ ${this.t(user, 'key_not_found')}`)
            .catch(logger.error);

          return false;
        }
        tariffId = vpnKey.tariff.id;
      }
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
            [
              Markup.button.callback(
                `⬅️ ${this.t(user, 'back')}`,
                backCallback,
              ),
            ],
          ]),
        })
        .catch(logger.error);

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
          `✅ ${this.t(user, 'promo_activated')}. ${this.t(user, 'price')}: <b>${priceResult.finalPrice} ${this.t(user, 'rub')}</b>\n${this.t(user, 'click')} ${this.t(user, 'buy')}:`,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  `✅ ${this.t(user, 'buy')}`,
                  `BUY_KEY:${id}`,
                ),
              ],
              [
                Markup.button.callback(
                  `⬅️ ${this.t(user, 'to_keys')}`,
                  'BTN_5',
                ),
              ],
            ]),
          },
        )
        .catch(logger.error);
    } else {
      this.pendingPromo.set(telegramId, {
        id: tariffId,
        promoCode: promoText,
        isRenew: false,
      });
      await ctx
        .reply(
          `✅ ${this.t(user, 'promo_activated')}. ${this.t(user, 'price')}: <b>${priceResult.finalPrice} ${this.t(user, 'rub')}</b>\n${this.t(user, 'click')} ${this.t(user, 'buy')}:`,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  `✅ ${this.t(user, 'buy')}`,
                  `BUY:${tariffId}`,
                ),
              ],
              [this.backToTariffsButton(user)],
            ]),
          },
        )
        .catch(logger.error);
    }
    return true;
  }

  onAddBalance = async (ctx: Context) => {
    const user = await this.getUserByCtx(ctx);
    const payload = this.getPayloadForAddBalance(user);
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
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) {
      await ctx
        .reply(`❌ ${this.t(user, 'enter_correct_number')}`)
        .catch(logger.error);
      return;
    }
    this.amountMap.set(telegramId, amount);

    const payload = this.getPayloadForAddBalance(user);
    if (!payload) return;
    await ctx.reply(payload.text, payload.extra).catch(logger.error);
  };

  public async sendMessageAddBalance(userId: string, balance: number) {
    const user = await this.em.findOne(UserEntity, { where: { id: userId } });
    if (!user?.chatId) return;

    await this.bot.telegram
      .sendMessage(
        user.chatId,
        `${this.t(user, 'improve_balance')} <b>${Math.ceil(balance)} ${this.t(user, 'rub')}</b>`,
        { parse_mode: 'HTML' },
      )
      .catch(logger.error);

    const userKeyExists = await this.em.exists(UserKeyEntity, {
      where: { userId },
    });

    if (userKeyExists) {
      await this.bot.telegram
        .sendMessage(
          user.chatId,
          `${this.t(user, 'select_action')}:`,
          this.menu(user),
        )
        .catch(logger.error);

      return;
    }

    const tariffButtons = await this.tariffsButtons(user);
    await this.bot.telegram
      .sendMessage(
        user.chatId,
        `${this.t(user, 'balance')}: ${user.balance} ${this.t(user, 'rub')}\n<b>${this.t(user, 'select_tariff')}:</b>`,
        {
          ...Markup.inlineKeyboard([
            ...tariffButtons,
            [Markup.button.callback(`🌐️ ${this.t(user, 'menu')}`, 'BTN_1')],
          ]),
        },
      )
      .catch(logger.error);
  }

  public async send8MarchMessage(user: UserEntity) {
    const filePath = path.join(
      __dirname,
      '../',
      '../',
      'public',
      'media',
      '8march.jpeg',
    );

    await this.bot.telegram
      .sendPhoto(user.chatId, Input.fromLocalFile(filePath), {
        caption: this.t(user, 'message_8_march'),
        parse_mode: 'HTML',
      })
      .catch(logger.error);
    await this.bot.telegram
      .sendMessage(user.chatId, '<b>MARCH8</b>', {
        parse_mode: 'HTML',
      })
      .catch(logger.error);
    await this.bot.telegram
      .sendMessage(user.chatId, `${this.t(user, 'select_action')}:`, {
        ...this.menu(user),
      })
      .catch(logger.error);
  }

  public async sendRequestToBuyKey(user: UserEntity) {
    const filePath = path.join(
      __dirname,
      '../',
      '../',
      'public',
      'media',
      'welcome.mp4',
    );

    const videoMessage = await this.bot.telegram
      .sendVideo(
        user.chatId,
        this.welcomeVideoId ?? Input.fromLocalFile(filePath),
        {
          disable_notification: true,
        },
      )
      .catch(logger.error);
    if (!videoMessage) return;
    if (!this.welcomeVideoId) {
      logger.info(`Set welcomeVideoId = '${videoMessage.video.file_id}'`);
      this.welcomeVideoId = videoMessage.video.file_id;
    }

    await this.bot.telegram
      .sendMessage(user.chatId, this.t(user, 'message_try_first_key'), {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              `⬅️ ${this.t(user, 'to_the_tariffs')}`,
              'BTN_9',
            ),
          ],
          [
            Markup.button.callback(
              `📖 ${this.t(user, 'instruction')}`,
              'ON_INSTRUCTION',
            ),
          ],
          [
            Markup.button.url(
              `👩‍💻 ${this.t(user, 'support')}`,
              'https://t.me/passimx',
            ),
          ],
        ]),
      })
      .catch(logger.error);
  }

  public async sendAlmostExpiredKey(user: UserEntity) {
    const keys = this.prepareKeysToButtons(user, user.keys);

    await this.bot.telegram
      .sendMessage(
        user.chatId,
        this.t(user, 'key_almost_expired'),
        Markup.inlineKeyboard([...keys, [this.backToProfileButton(user)]]),
      )
      .catch(logger.error);
  }

  public async replyUsersWithoutKeys() {
    const users = await this.em
      .createQueryBuilder(UserEntity, 'users')
      .leftJoin('users.keys', 'keys')
      .groupBy('users.id')
      .having('COUNT(keys.id) = 0')
      .getMany();

    for (const user of users) {
      await this.sendRequestToBuyKey(user);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  public async sendMessageKeyExpired(keyId: string) {
    const key = await this.em.findOneOrFail(UserKeyEntity, {
      where: { id: keyId },
      relations: ['user', 'server'],
    });
    const user = key.user;

    const buttons = this.prepareKeysToButtons(user, [key]);
    await this.bot.telegram.sendMessage(
      user.chatId,
      `${this.t(user, 'key_expired')}\n` + `${this.t(user, 'select_action')}:`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          ...buttons,
          [Markup.button.callback(`⬅️ ${this.t(user, 'back')}`, 'BTN_2')],
        ]),
      },
    );
  }

  public async sendMessageEveryOne(key: string) {
    const filePath = path.join(
      __dirname,
      '../',
      '../',
      'public',
      'media',
      'select_server.mp4',
    );

    const users = await this.em.find(UserEntity);

    for (const user of users) {
      try {
        const videoMessage = await this.bot.telegram
          .sendVideo(
            user.chatId,
            this.changeVideoId ?? Input.fromLocalFile(filePath),
            {
              caption: this.t(user, key),
              supports_streaming: true,
              disable_notification: true,
              parse_mode: 'HTML',
            },
          )
          .catch(logger.error);

        await this.bot.telegram
          .sendMessage(user.chatId, `${this.t(user, 'select_action')}:`, {
            ...this.menu(user),
          })
          .catch(logger.error);

        if (!videoMessage) return;
        if (!this.changeVideoId) {
          logger.info(`Set changeVideoId = '${videoMessage.video.file_id}'`);
          this.changeVideoId = videoMessage.video.file_id;
        }

        await new Promise((r) => setTimeout(r, 100));
      } catch (e) {
        logger.error(e);
      }
    }
  }

  private getPayloadForAddBalance = (user: UserEntity) => {
    const amount = this.amountMap.get(user.telegramId);
    if (!amount) return;
    const text: string =
      `${this.t(user, 'deposit_amount')}: ${amount} ${this.t(user, 'rub')}\n` +
      `${this.t(user, 'select_payment_method')}:`;

    const buttons = [
      [
        Markup.button.callback(
          `${this.t(user, 'ru_flag')} ${this.t(user, 'ru_payment')}`,
          'ON_YOOKASSA',
        ),
        Markup.button.callback(
          `${this.t(user, 'zh_flag')} ${this.t(user, 'zh_payment')}`,
          'ON_WECHAT',
        ),
      ],
      [
        Markup.button.callback(
          `💎 ${this.t(user, 'ton_payment')} (+${Envs.crypto.allowance * 100}%)`,
          'BTN_8',
        ),
      ],
    ];

    const extra = Markup.inlineKeyboard([
      ...buttons,
      [this.backToSetAmountButton(user)],
    ]);

    return { text, extra };
  };

  private async tariffsButtons(user: UserEntity) {
    const userKey = await this.em.exists(UserKeyEntity, {
      where: { userId: user.id },
    });

    const list = await this.em.find(TariffEntity, {
      where: userKey
        ? { active: true, price: MoreThanOrEqual(1) } // если есть хотя бы один ключ → показываем только платные
        : { active: true }, // иначе платные и бесплатные период
      order: { price: 'ASC' },
    });

    return list.map((t) => [
      Markup.button.callback(
        `${this.t(user, `tariff_${t.expirationDays}`)} — ${t.price} ${this.t(user, 'rub')}`,
        `T:${t.id}`,
      ),
    ]);
  }

  private prepareKeysToButtons(ctx: UserEntity, keys: UserKeyEntity[]) {
    return keys.map(({ id, expiresAt, status, server }, index) => {
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
  }
}
