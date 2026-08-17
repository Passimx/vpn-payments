import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Context, Input, Markup, Telegraf } from 'telegraf';

import { EntityManager } from 'typeorm';
import { UserEntity } from '../database/entities/user.entity';
import { TariffEntity } from '../database/entities/tariff.entity';
import { UserKeyEntity } from '../database/entities/user-key.entity';
import { Envs } from '../../common/env/envs';
import { KeyPurchaseService } from '../key-purchase/key-purchase.service';
import { TransactionsService } from '../transactions/transactions.service';
import path from 'node:path';
import { I18nService } from '../i18n/i18n.service';
import { XrayService } from '../xray/xray-service';
import { PromoUsageEntity } from '../database/entities/promo-usage.entity';
import { AnalyticsService } from './analytics.service';
import { logger } from '../../common/logger/logger';
import { BalanceAccount } from '../database/entities/balance-account.entity';
import { CurrencyEnum } from '../transactions/types/currency.enum';
import { ResendMessageType } from './types/resend-message.type';
import { AppWalletEnum } from '../ton/enums/app-wallet.enum';
import { DownloadLinksType, KeyEnum } from './types/download-links.type';
import { TransactionEntity } from '../database/entities/transaction.entity';
import { InvoicesService } from '../transactions/invoices.service';

export let bot: Telegraf;
let resendMessageData: ResendMessageType | undefined;

@Injectable()
export class TelegramService {
  private amountMap = new Map<number, number>();
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
    @Inject(forwardRef(() => AnalyticsService))
    private readonly analyticsService: AnalyticsService,
    private readonly i18nService: I18nService,
    @Inject(forwardRef(() => XrayService))
    private readonly xrayService: XrayService,
    private readonly invoicesService: InvoicesService,
  ) {}

  async onModuleInit() {
    bot = new Telegraf(Envs.telegram.botToken);
    bot.catch(logger.error);

    bot.command('stats', this.analyticsService.sendAnalytics);
    bot.command('resendMessage', this.saveResendMessage);

    bot.start(this.onStart);
    bot.action('BTN_1', this.onBtn1);
    bot.action('BTN_2', this.onBtn2);
    bot.action('ON_INSTRUCTION', this.onInstruction);
    bot.action('BTN_4', this.onBtn4);
    bot.action('BTN_5', this.onBtn5);
    bot.action('BTN_8', this.onBtn8);
    bot.action('BTN_9', this.onBtn9);
    bot.action('BTN_11', this.onBtn11);
    bot.action(/^BTN_12:([\w-]+)$/, this.onBtn12);
    bot.action('BTN_13', this.onBtn13);
    bot.action('ON_STARS', this.onPayTelegramStars);
    bot.action(/^KEY_DETAILS:([\w-]+)$/, this.onKeyDetails);
    bot.action(/^DELETE_KEY:([\w-]+)$/, this.onDeleKey);
    bot.action('BTN_BALANCE', this.onBalance);
    bot.action('ON_MY_REF_LINK', this.onMyRefLink);
    bot.action('ADD_BALANCE', this.onAddBalance);
    bot.action('ON_ADD_BALANCE_INSTRUCTION', this.onAddBalanceInstruction);
    bot.action('ON_ADD_KEY_INSTRUCTION', this.onAddKeyInstruction);
    bot.action('ON_WECHAT', this.onWechat);
    bot.action('ON_YOOKASSA', this.onYookassa);
    bot.action('ON_LANGUAGE', this.onLanguage);
    bot.action(/^ON_SET_LANGUAGE:[\w-]+$/, this.onSetLanguage);
    bot.action(/^T:[\w-]+$/, this.onTariffSelect);
    bot.action(/^PROMO:([\w-]+)$/, this.onPromoClick);
    bot.action(/^BUY:[\w-]+$/, this.onBuyTariff);
    bot.action(/^BUY_XRAY:[\w-]+$/, this.onBuyTariff);
    bot.action(/^BUY_HYST:[\w-]+$/, this.onBuyTariff);
    bot.action('TARIFFS_BASE', this.onTariffsBase);
    bot.action('TARIFFS_PREMIUM', this.onTariffsPremium);
    bot.action('TARIFFS_VIP', this.onTariffsVip);
    bot.action(/^BUY_KEY:([\w-]+)$/, this.onBuyTariff);
    bot.action(/^RENEW:([\w-]+)$/, this.onRenewKey);
    bot.action(/^AUTO_RENEW_TOGGLE:([\w-]+)$/, this.onAutoRenewToggle);
    bot.action(/^PROMO_KEY:([\w-]+)$/, this.onRenewPromo);
    bot.action(/^BUTTON_MONEY:([\d.,]+)$/, this.onSetButtonMoney);

    bot.on('pre_checkout_query', this.onPreCheckoutQuery);
    bot.on('successful_payment', this.onSuccessfulPayment);
    bot.on('text', this.onText);

    const userInfo = await bot.telegram.getMe();
    if (!userInfo.username.includes('test'))
      for (const lang of Object.keys(this.i18nService.langs)) {
        await Promise.all([
          bot.telegram.setMyDescription(this.t(lang, 'description'), lang),
          bot.telegram.setMyShortDescription(
            this.t(lang, 'short_description'),
            lang,
          ),
        ]);
      }

    void bot.launch();
  }

  onModuleDestroy() {
    bot.stop();
  }

  private t(payload: UserEntity | string, key: string) {
    let lang = 'en';

    if (typeof payload === 'string') lang = payload;
    else if (payload.languageCode) lang = payload.languageCode;

    return this.i18nService.t(lang, key);
  }

  private getVipLaunchDiscount(): number | null {
    const { discountPercent, discountUntil } = Envs.vipLaunch;
    if (!discountPercent || !discountUntil) return null;
    if (new Date() > discountUntil) return null;
    return discountPercent;
  }

  private profileMenu = (user: UserEntity) => {
    return Markup.inlineKeyboard([
      [Markup.button.callback(`🔑 ${this.t(user, 'my_keys')}`, 'BTN_5')],
      [Markup.button.callback(`🛒 ${this.t(user, 'buy_key')}`, 'BTN_9')],
      [
        Markup.button.callback(
          `💸 ${this.t(user, 'put_money')}`,
          'BTN_BALANCE',
        ),
      ],
      [
        Markup.button.callback(
          `🔗 ${this.t(user, 'my_ref_link')}`,
          'ON_MY_REF_LINK',
        ),
      ],
      [Markup.button.callback(`⬅️ ${this.t(user, 'back')}`, 'BTN_2')],
    ]);
  };

  private menu = (user: UserEntity) =>
    Markup.inlineKeyboard([
      [Markup.button.callback(`🌐️ ${this.t(user, 'menu')}`, 'BTN_1')],
      [
        Markup.button.callback(
          `📖 ${this.t(user, 'instruction')}`,
          'ON_INSTRUCTION',
        ),
        Markup.button.url(
          `👩‍💻 ${this.t(user, 'support')}`,
          Envs.telegram.supportProfile,
        ),
      ],
      [
        Markup.button.callback(
          `🌏 ${this.t(user, 'change_language')}`,
          'ON_LANGUAGE',
        ),
      ],
      // [
      //   Markup.button.url(
      //     `📄 ${this.t(user, 'user_agreement')}`,
      //     'https://passimx.ru/info/ru/vpn-user-agreement.html',
      //   ),
      // ],
    ]);

  private backToProfileButton = (user: UserEntity) =>
    Markup.button.callback(`⬅️ ${this.t(user, 'back')}`, 'BTN_1');

  private backToPayWaysButton = (user: UserEntity) =>
    Markup.button.callback(`⬅️ ${this.t(user, 'back')}`, 'ADD_BALANCE');

  private backToSetAmountButton = (user: UserEntity) =>
    Markup.button.callback(`⬅️ ${this.t(user, 'back')}`, 'BTN_BALANCE');

  private backToTariffsButton = (user: UserEntity) =>
    Markup.button.callback(`⬅️ ${this.t(user, 'to_the_tariffs')}`, 'BTN_9');

  public static readonly downloadLinks: DownloadLinksType = {
    ios: {
      happ: 'https://apps.apple.com/ke/app/happ-proxy-utility/id6504287215',
      hiddify: 'https://apps.apple.com/us/app/hiddify-proxy-vpn/id6596777532',
      incy: 'https://apps.apple.com/us/app/incy/id6756943388',
    },
    android: {
      happ: 'https://play.google.com/store/apps/details?id=com.happproxy',
      hiddify: 'https://play.google.com/store/search?q=hiddify&c=apps&hl=en',
      incy: 'https://play.google.com/store/apps/details?id=llc.itdev.incy',
    },
    windows: {
      happ: 'https://github.com/Happ-proxy/happ-desktop/releases/latest/download/setup-Happ.x64.exe',
      hiddify:
        'https://github.com/hiddify/hiddify-app/releases/latest/download/Hiddify-Windows-Setup-x64.exe',
      incy: 'https://github.com/INCY-DEV/incy-platforms/releases/download/desktop-v3.2.6/incy-windows-setup.exe',
    },
  };

  public createInvoice = async (userId: string, amount: number) => {
    try {
      const now = Date.now();
      const id = BigInt(now);

      const starsAmount = Math.ceil(amount);
      const usdAmount = starsAmount * TransactionsService.telegramStarsRate;
      const text = `${starsAmount} Telegram Stars`;

      const paymentUrl = await bot.telegram.createInvoiceLink({
        title: text,
        description: text,
        payload: `${id}`,
        provider_token: Envs.telegram.botToken,
        currency: 'XTR',
        prices: [{ label: 'Telegram Stars', amount: starsAmount }],
      });

      const transaction = {
        id,
        amount: usdAmount,
        currency: CurrencyEnum.USD,
        userId,
        type: 'Credit',
        place: 'telegram',
        createdAt: now,
        paymentUrl,
      } as Partial<TransactionEntity>;

      await this.em.insert(TransactionEntity, transaction);

      return paymentUrl;
    } catch (error) {
      console.error(error);
    }
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
      .replyWithVideo(Input.fromLocalFile(filePath), {
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

    await this.setOpenAppButton(ctx);
  };

  onPreCheckoutQuery = async (ctx: Context) => {
    await ctx.answerPreCheckoutQuery(true).catch(() => {});
  };

  onSuccessfulPayment = async (ctx: Context) => {
    const message = ctx.message as unknown as {
      successful_payment: { total_amount: number; invoice_payload: string };
    };
    const payment = message.successful_payment;
    const transactionId = BigInt(payment.invoice_payload);
    const starsPaid = payment.total_amount;

    const transaction = await this.em.findOne(TransactionEntity, {
      where: { id: transactionId },
    });
    if (!transaction) return;

    await this.transactionsService.addBalance(
      transaction.userId,
      starsPaid * TransactionsService.telegramStarsRate,
      CurrencyEnum.USD,
    );

    await this.em.update(
      TransactionEntity,
      { id: transaction.id },
      { completed: true },
    );
  };

  onPayTelegramStars = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const user = await this.getUserByCtx(ctx);

    const amount = this.amountMap.get(user.telegramId!);
    if (!amount) return;

    const correctAmount = await this.transactionsService.convert(
      amount,
      this.t(user, 't11') as CurrencyEnum,
      CurrencyEnum.USD,
    );

    const starsAmount = Math.ceil(
      correctAmount / TransactionsService.telegramStarsRate,
    );

    const now = Date.now();
    const id = BigInt(now);

    const transaction = {
      id,
      amount: correctAmount,
      currency: CurrencyEnum.USD,
      userId: user.id,
      type: 'Credit',
      place: 'telegram',
      createdAt: now,
    } as Partial<TransactionEntity>;

    await this.em.insert(TransactionEntity, transaction);

    await ctx.replyWithInvoice({
      title: this.t(user, 'stars_invoice_title'),
      description: `${this.t(user, 'deposit_amount')} ${this.transactionsService.formatNumber(amount, this.t(user, 't10') as CurrencyEnum)}`,
      payload: `${id}`,
      provider_token: Envs.telegram.botToken,
      currency: 'XTR',
      prices: [{ label: 'Telegram Stars', amount: starsAmount }],
    });
  };

  onYookassa = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const user = await this.getUserByCtx(ctx);
    if (!user.telegramId) return;
    const amount = this.amountMap.get(user.telegramId);
    if (!amount) return;

    const processingMessage = await ctx.reply(this.t(user, 'processing'));

    const convertedAmount = await this.transactionsService.convert(
      amount,
      this.t(user, 't11') as CurrencyEnum,
      CurrencyEnum.RUB,
    );

    const result = await this.invoicesService.getSberInvoice(
      user.id,
      convertedAmount,
    );
    await ctx.deleteMessage(processingMessage.message_id);
    if (!result) {
      await ctx
        .editMessageText(`❌ ${this.t(user, 'yookassa_not_found')}`, {
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
        `${this.t(user, 'ru_payment_message')}\n${this.t(user, 'deposit_amount')}: ${this.transactionsService.formatNumber(await this.transactionsService.convert(amount, this.t(user, 't11') as CurrencyEnum, CurrencyEnum.RUB), '₽')}`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.url('💳 YooKassa', result)],
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
    if (!user.telegramId) return;
    const amount = this.amountMap.get(user.telegramId);
    const price = await this.transactionsService.getCurrencyPrice();
    if (!amount) return;
    if (!price) return;

    const processingMessage = await ctx.reply(this.t(user, 'processing'));

    const convertedAmount = await this.transactionsService.convert(
      amount,
      this.t(user, 't11') as CurrencyEnum,
      CurrencyEnum.CNY,
    );

    const result = await this.invoicesService.getWechatInvoice(
      user.id,
      convertedAmount,
    );

    if (!result) {
      await ctx
        .editMessageText(`❌ ${this.t(user, 'error')}`, {
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

    const invoiceQrCode = await this.invoicesService.createImage(result);

    await ctx.deleteMessage(processingMessage.message_id);
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
        [Markup.button.callback(`⬅️ ${this.t(user, 'back')}`, 'BTN_2')],
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

    await this.setOpenAppButton(ctx);
    await ctx
      .editMessageText(`${this.t(user, 'select_action')}:`, this.menu(user))
      .catch(logger.error);
  };

  onBtn1 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const telegramId = ctx?.from?.id;
    const user = await this.getUserByCtx(ctx);

    this.amountMap.delete(telegramId!);

    const balance = await this.transactionsService.getUserTotalBalance(
      user.balanceAccount,
      this.t(user, 't11') as CurrencyEnum,
    );

    await ctx
      .editMessageText(
        `ID: ${user.id}\n${this.t(user, 'balance')}: ${this.transactionsService.formatNumber(balance, this.t(user, 't10'))}`,
        Markup.inlineKeyboard([
          [Markup.button.callback(`🔑 ${this.t(user, 'my_keys')}`, 'BTN_5')],
          [Markup.button.callback(`🛒 ${this.t(user, 'buy_key')}`, 'BTN_9')],
          [
            Markup.button.callback(
              `💸 ${this.t(user, 'put_money')}`,
              'BTN_BALANCE',
            ),
          ],
          [
            Markup.button.callback(
              `🔗 ${this.t(user, 'my_ref_link')}`,
              'ON_MY_REF_LINK',
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
      .replyWithVideo(Input.fromLocalFile(filePath), {
        caption: `${this.t(user, 'video_instruction')}: ${this.t(user, 'how_to_connect_key')}\n\n${this.t(user, 'required_steps')}:\n${this.t(user, 'menu')} -> ${this.t(user, 'buy_key')} -> ${this.t(user, 'select_tariff')} -> ${this.t(user, 'buy')} -> ${this.t(user, 'copy_key')} -> ${this.t(user, 'open_download_app')} -> ${this.t(user, 'insert_key')} -> ${this.t(user, 'connect_vpn')}`,
        width: 720,
        height: 1280,
        supports_streaming: true,
        disable_notification: true,
      })
      .catch(logger.error);

    if (!videoMessage) return;

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
      .replyWithVideo(Input.fromLocalFile(filePath), {
        caption: `${this.t(user, 'video_instruction')}: ${this.t(user, 'how_to_put_money')}\n\n${this.t(user, 'required_steps')}:\n${this.t(user, 'menu')} -> ${this.t(user, 'put_money')} -> ${this.t(user, 'enter_amount')} -> ${this.t(user, 'select_payment_method')} -> ${this.t(user, 'payment')}`,
        width: 720,
        height: 1280,
        supports_streaming: true,
        disable_notification: true,
      })
      .catch(logger.error);

    if (!videoMessage) return;

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

  onBtn13 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const user = await this.getUserByCtx(ctx);

    await ctx.editMessageText(this.t(user, 't15'), {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback(`⬅️ ${this.t(user, 'back')}`, 'BTN_4')],
      ]),
    });
  };

  onBtn12 = async (ctx: Context) => {
    const data = (ctx.callbackQuery as { data?: string })?.data ?? '';
    const key = data.replace('BTN_12:', '') as keyof DownloadLinksType;

    ctx.answerCbQuery().catch(logger.error);
    const user = await this.getUserByCtx(ctx);
    await ctx.editMessageText(`📲 ${this.t(user, 'app_links')}`, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [
          Markup.button.url('HAPP', TelegramService.downloadLinks[key].happ),
          Markup.button.url(
            'Hiddify',
            TelegramService.downloadLinks[key].hiddify,
          ),
        ],
        [Markup.button.url('INCY', TelegramService.downloadLinks[key].incy)],
        key === KeyEnum.IOS
          ? [Markup.button.callback(this.t(user, 't14'), 'BTN_13')]
          : [],
        [Markup.button.callback(`⬅️ ${this.t(user, 'back')}`, 'BTN_4')],
      ]),
    });
  };

  onBtn4 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const user = await this.getUserByCtx(ctx);
    await ctx
      .editMessageText(`${this.t(user, 't13')}:`, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('📱 Android', `BTN_12:${KeyEnum.ANDROID}`),
            Markup.button.callback('🍎 iOS', `BTN_12:${KeyEnum.IOS}`),
          ],
          [
            Markup.button.callback('💻 Windows', `BTN_12:${KeyEnum.WINDOWS}`),
            Markup.button.callback('🍏 Mac', `BTN_12:${KeyEnum.IOS}`),
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
      relations: ['tariff'],
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
    if (!user.telegramId) return;
    const callbackData = (ctx.callbackQuery as { data?: string })?.data ?? '';
    const amount = Number(
      callbackData.replace(/^(BUTTON_MONEY):/, '').replace(',', '.'),
    );
    this.amountMap.set(user.telegramId, amount);
    const payload = this.getPayloadForAddBalance(user);
    if (!payload) return;
    await ctx.editMessageText(payload.text, payload.extra);
  };

  onMyRefLink = async (ctx: Context) => {
    const user = await this.getUserByCtx(ctx);
    const count = await this.em.count(UserEntity, {
      where: { source: user.id },
    });

    await ctx.editMessageText(
      `${this.t(user, 'ref_link_description')}:\n\n<code>https://t.me/${ctx.botInfo.username}?start=${user.id}</code>\n\n${this.t(user, 't12')}: ${count}`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`⬅️ ${this.t(user, 'back')}`, 'BTN_1')],
        ]),
      },
    );
  };

  onBalance = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const user = await this.getUserByCtx(ctx);
    if (!user.telegramId) return;

    const price100 = await this.transactionsService.convert(
      100,
      CurrencyEnum.RUB,
      this.t(user, 't11') as CurrencyEnum,
    );

    const price200 = await this.transactionsService.convert(
      200,
      CurrencyEnum.RUB,
      this.t(user, 't11') as CurrencyEnum,
    );

    const price300 = await this.transactionsService.convert(
      300,
      CurrencyEnum.RUB,
      this.t(user, 't11') as CurrencyEnum,
    );

    const price1000 = await this.transactionsService.convert(
      1000,
      CurrencyEnum.RUB,
      this.t(user, 't11') as CurrencyEnum,
    );

    this.amountMap.set(user.telegramId, 0);
    await ctx
      .editMessageText(
        `💳 <b>${this.t(user, 'enter_amount')} (${this.t(user, 't10')})</b>:`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback(
                `${this.transactionsService.formatNumber(
                  price100,
                  this.t(user, 't10'),
                )}`,
                `BUTTON_MONEY:${price100}`,
              ),
              Markup.button.callback(
                `${this.transactionsService.formatNumber(
                  price200,
                  this.t(user, 't10'),
                )}`,
                `BUTTON_MONEY:${price200}`,
              ),
            ],
            [
              Markup.button.callback(
                `${this.transactionsService.formatNumber(
                  price300,
                  this.t(user, 't10'),
                )}`,
                `BUTTON_MONEY:${price300}`,
              ),
              Markup.button.callback(
                `${this.transactionsService.formatNumber(
                  price1000,
                  this.t(user, 't10'),
                )}`,
                `BUTTON_MONEY:${price1000}`,
              ),
            ],
            [this.backToProfileButton(user)],
          ]),
        },
      )
      .catch(logger.error);
  };

  private async getUserByCtx(ctx: Context): Promise<UserEntity> {
    const user = await this.em.findOne(UserEntity, {
      where: { telegramId: ctx?.from!.id },
      relations: ['balanceAccount'],
    });
    if (user) return user;

    let source: undefined | string = undefined;
    const { payload } = ctx as unknown as { payload?: string };
    if (payload && payload.length > 0) {
      source = payload;
    }

    const id = crypto.randomUUID().replace(/-/g, '');
    await this.em.insert(UserEntity, {
      id,
      telegramId: ctx?.from!.id,
      userName: ctx?.from!.username,
      languageCode: ctx?.from!.language_code,
      source,
    });
    await this.em.insert(BalanceAccount, {
      userId: id,
    });

    return this.getUserByCtx(ctx);
  }

  // Общий список тарифов (покупка и продление)
  private async showActiveTariffsList(
    ctx: Context,
    user: UserEntity,
    backButtonRow: ReturnType<typeof Markup.button.callback>[],
    kind: 'base' | 'premium' | 'cdn' = 'base',
  ): Promise<void> {
    const tariffButtons = await this.tariffsButtons(user, kind);
    const balance = await this.transactionsService.getUserTotalBalance(
      user.balanceAccount,
      this.t(user, 't11') as CurrencyEnum,
    );

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
        `${this.t(user, 'balance')}: ${this.transactionsService.formatNumber(balance, this.t(user, 't10'))}\n<b>${this.t(user, 'select_tariff')}:</b>`,
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
    const limitBytes =
      tariff.trafficLimit === undefined ? null : tariff.trafficLimit;
    const trafficText = limitBytes
      ? this.formatTrafficLimit(limitBytes)
      : this.t(user, 'unlimited');

    const originalPriceFormatted = this.transactionsService.formatNumber(
      await this.transactionsService.convert(
        tariff.price,
        CurrencyEnum.RUB,
        this.t(user, 't11') as CurrencyEnum,
      ),
      this.t(user, 't10'),
    );
    const vipDiscount =
      tariff.kind === 'cdn' ? this.getVipLaunchDiscount() : null;

    let banner = '';
    let priceText = originalPriceFormatted;
    if (vipDiscount) {
      const discountedPriceFormatted = this.transactionsService.formatNumber(
        await this.transactionsService.convert(
          Math.round(Number(tariff.price) * (1 - vipDiscount / 100)),
          CurrencyEnum.RUB,
          this.t(user, 't11') as CurrencyEnum,
        ),
        this.t(user, 't10'),
      );
      banner = `🔥🔥🔥 <b>${this.t(user, 'sale_banner')} −${vipDiscount}%</b> 🔥🔥🔥\n\n`;
      priceText = `<del>${originalPriceFormatted}</del> ➡️ <b>${discountedPriceFormatted}</b>`;
    }

    const text =
      banner +
      `📦 <b>${this.t(user, `${Number(tariff.price) === 0 ? 'tariff_trial_' : 'tariff_'}${tariff.expirationDays}`)}</b>\n\n` +
      `📊 ${this.t(user, 'traffic')}: ${trafficText}\n` +
      `📅 ${this.t(user, 'term')}: ${tariff.expirationDays} ${this.t(user, 'days')}\n` +
      `💰 ${this.t(user, 'price')}: ${priceText}\n`;

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
    if (!user.telegramId) return;
    const amountFromSet = this.amountMap.get(user.telegramId);
    if (amountFromSet === undefined) return;

    const amount = await this.transactionsService.convert(
      amountFromSet,
      this.t(user, 't11') as CurrencyEnum,
      CurrencyEnum.TON,
    );

    await ctx
      .editMessageText(
        `⬇️ <b>${this.t(user, 'payment_inf')}</b>\n` +
          `${this.t(user, 'click_for_the_copy')}` +
          `${this.t(user, 'wallet_address')}: <code>${Envs.crypto.ton.walletAddress}</code>\n` +
          `${this.t(user, 'amount')}: <code>${this.transactionsService.formatNumber(amount, 'TON')}</code>\n` +
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
              Markup.button.callback('USDT', 'BTN_11'),
            ],
            [
              Markup.button.url(
                'MyTonWallet',
                this.invoicesService.getTonInvoice(
                  user.id,
                  amount,
                  CurrencyEnum.TON,
                  AppWalletEnum.MY_TON_WALLET,
                ),
              ),
            ],
            [
              Markup.button.url(
                'Tonkeeper',
                this.invoicesService.getTonInvoice(
                  user.id,
                  amount,
                  CurrencyEnum.TON,
                  AppWalletEnum.TON_KEEPER,
                ),
              ),
            ],
            [
              Markup.button.url(
                'Tonhub',
                this.invoicesService.getTonInvoice(
                  user.id,
                  amount,
                  CurrencyEnum.TON,
                  AppWalletEnum.TON_HUB,
                ),
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
    if (!user.telegramId) return;
    const amountFromSet = this.amountMap.get(user.telegramId);
    if (amountFromSet === undefined) return;

    const amount = await this.transactionsService.convert(
      amountFromSet,
      this.t(user, 't11') as CurrencyEnum,
      CurrencyEnum.USD,
    );

    await ctx
      .editMessageText(
        `⬇️ <b>${this.t(user, 'payment_inf')}</b>\n` +
          `${this.t(user, 'click_for_the_copy')}` +
          `${this.t(user, 'wallet_address')}: <code>${Envs.crypto.ton.walletAddress}</code>\n` +
          `${this.t(user, 'amount')}: <code>${this.transactionsService.formatNumber(amount, 'USDT')}</code>\n` +
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
                this.invoicesService.getTonInvoice(
                  user.id,
                  amount,
                  CurrencyEnum.USD,
                  AppWalletEnum.MY_TON_WALLET,
                ),
              ),
            ],
            [
              Markup.button.url(
                'Tonkeeper',
                this.invoicesService.getTonInvoice(
                  user.id,
                  amount,
                  CurrencyEnum.USD,
                  AppWalletEnum.TON_KEEPER,
                ),
              ),
            ],
            [
              Markup.button.url(
                'Tonhub',
                this.invoicesService.getTonInvoice(
                  user.id,
                  amount,
                  CurrencyEnum.USD,
                  AppWalletEnum.TON_HUB,
                ),
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
    await ctx
      .editMessageText(this.t(user, 'select_vpn_type_message'), {
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              this.t(user, 'vpn_type_base_button'),
              'TARIFFS_BASE',
            ),
          ],
          // Каскадный ключ временно скрыт из покупки через бота (оставлен код на будущее).
          // [
          //   Markup.button.callback(
          //     this.t(user, 'vpn_type_premium_button'),
          //     'TARIFFS_PREMIUM',
          //   ),
          // ],
          [
            Markup.button.callback(
              this.t(user, 'vpn_type_vip_button'),
              'TARIFFS_VIP',
            ),
          ],
          [this.backToProfileButton(user)],
        ]),
      })
      .catch(logger.error);
  };

  onTariffsBase = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const user = await this.getUserByCtx(ctx);
    if (!user) return;
    await this.showActiveTariffsList(ctx, user, [
      this.backToProfileButton(user),
    ]);
  };

  onTariffsPremium = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const user = await this.getUserByCtx(ctx);
    if (!user) return;
    await this.showActiveTariffsList(
      ctx,
      user,
      [Markup.button.callback(`⬅️ ${this.t(user, 'back')}`, 'BTN_9')],
      'premium',
    );
  };

  onTariffsVip = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const user = await this.getUserByCtx(ctx);
    if (!user) return;
    await this.showActiveTariffsList(
      ctx,
      user,
      [Markup.button.callback(`⬅️ ${this.t(user, 'back')}`, 'BTN_9')],
      'cdn',
    );
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
      const renewKey = await this.em.findOne(UserKeyEntity, {
        where: { id: renewKeyId, userId: user.id },
        relations: ['tariff'],
      });
      if (!renewKey?.tariff) {
        await ctx
          .answerCbQuery(this.t(user, 'key_not_found'))
          .catch(logger.error);
        return;
      }
      if (renewKey.tariff.kind !== tariff.kind) {
        await ctx
          .answerCbQuery(this.t(user, 'mismatched_tariff_for_renew'))
          .catch(logger.error);
        return;
      }

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
    keyId: string,
    backButton: ReturnType<typeof Markup.button.callback>,
  ): Promise<void> {
    const user = await this.getUserByCtx(ctx);

    const subLink = `${Envs.main.appUrl}/keys-info/${keyId}`;
    const text =
      `✅ <b>${this.t(user, 'key_created')}</b>\n\n` +
      `<b>📋 ${this.t(user, 'click_to_copy_key')}:</b>\n` +
      `<code>${subLink}</code>\n\n` +
      `${this.t(user, 'instruction_how_to_use_key')}.`;

    await ctx
      .editMessageText(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('📱 Android', `BTN_12:${KeyEnum.ANDROID}`),
            Markup.button.callback('🍎 iOS', `BTN_12:${KeyEnum.IOS}`),
          ],
          [
            Markup.button.callback('💻 Windows', `BTN_12:${KeyEnum.WINDOWS}`),
            Markup.button.callback('🍏 Mac', `BTN_12:${KeyEnum.IOS}`),
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
      if (!result.success && typeof result.data === 'string') {
        await ctx
          .editMessageText(`❌ ${this.t(user, result.data)}`, {
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
      if (!result.success && typeof result.data === 'string') {
        await ctx
          .editMessageText(`❌ ${this.t(user, result.data)}`, {
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

      if (typeof result.data !== 'string')
        await this.showKeyCreatedScreen(
          ctx,
          result.data.keyId,
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

    const renewKind =
      vpnKey.cascadeToServerId != null || vpnKey.tariff.kind === 'cascade'
        ? 'premium'
        : vpnKey.tariff.kind === 'cdn'
          ? 'cdn'
          : 'base';
    await this.showActiveTariffsList(
      ctx,
      user,
      [Markup.button.callback(`⬅️ ${this.t(user, 'back')}`, 'BTN_5')],
      renewKind,
    );
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

  onKeyDetails = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const data = (ctx.callbackQuery as { data?: string })?.data ?? '';
    const keyId = data.replace('KEY_DETAILS:', '');
    const user = await this.getUserByCtx(ctx);
    const vpnKey = await this.findUserKeyWithDetails(user.id, keyId);
    if (!vpnKey) {
      await ctx
        .answerCbQuery(this.t(user, 'key_not_found'))
        .catch(logger.error);
      return;
    }

    await this.renderKeyDetails(ctx, user, vpnKey);
  };

  onAutoRenewToggle = async (ctx: Context) => {
    ctx.answerCbQuery().catch(logger.error);
    const data = (ctx.callbackQuery as { data?: string })?.data ?? '';
    const keyId = data.replace('AUTO_RENEW_TOGGLE:', '');
    const user = await this.getUserByCtx(ctx);
    const vpnKey = await this.findUserKeyWithDetails(user.id, keyId);
    if (!vpnKey) {
      await ctx
        .answerCbQuery(this.t(user, 'key_not_found'))
        .catch(logger.error);
      return;
    }

    await this.em.update(
      UserKeyEntity,
      { id: vpnKey.id },
      { autoRenewEnabled: !vpnKey.autoRenewEnabled },
    );

    const updatedKey = await this.findUserKeyWithDetails(user.id, keyId);
    if (!updatedKey) return;

    await this.renderKeyDetails(ctx, user, updatedKey);
  };

  onDeleKey = async (ctx: Context) => {
    const data = (ctx.callbackQuery as { data?: string })?.data ?? '';
    const keyId = data.replace('DELETE_KEY:', '');
    const user = await this.getUserByCtx(ctx);

    await this.em.softDelete(UserKeyEntity, {
      id: keyId,
      userId: user.id,
    });

    await this.onBtn1(ctx);
  };

  private findUserKeyWithDetails(userId: string, keyId: string) {
    return this.em.findOne(UserKeyEntity, {
      where: { id: keyId, userId },
      relations: ['tariff'],
    });
  }

  private async renderKeyDetails(
    ctx: Context,
    user: UserEntity,
    vpnKey: UserKeyEntity,
  ) {
    const expires =
      vpnKey.expiresAt &&
      new Date(vpnKey.expiresAt).toLocaleDateString('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });

    const progress = this.xrayService.getPremiumTrafficProgress(vpnKey);
    const trafficLine = progress
      ? `<b>${this.t(user, 'traffic')}:</b> ${progress}`
      : '';

    const lines = [
      `🔑 <b>${this.t(user, 'my_keys')}</b>\n`,
      `<b>ID:</b> ${vpnKey.id}`,
      `<b>${this.t(user, 'status')}:</b> ${this.t(user, vpnKey.status)}`,
      expires ? `<b>${this.t(user, 'until')}:</b> ${expires}` : '',
      `<b>${this.t(user, 'auto_renew')}:</b> ${vpnKey.autoRenewEnabled ? this.t(user, 'enabled') : this.t(user, 'disabled')}`,
      trafficLine,
      `<b>${this.t(user, 't16')}:</b>\n`,
      `<code>${Envs.main.appUrl}/keys-info/${vpnKey.id}</code>`,
    ].filter(Boolean);

    const buttons: ReturnType<typeof Markup.button.callback>[][] = [];

    buttons.push([
      Markup.button.callback(
        `🔄 ${this.t(user, 'extend_key')}`,
        `RENEW:${vpnKey.id}`,
      ),
    ]);
    buttons.push([
      Markup.button.callback(
        vpnKey.autoRenewEnabled
          ? `⛔ ${this.t(user, 'disable_auto_renew')}`
          : `✅ ${this.t(user, 'enable_auto_renew')}`,
        `AUTO_RENEW_TOGGLE:${vpnKey.id}`,
      ),
    ]);

    buttons.push([
      Markup.button.url(
        'Hiddify',
        `${Envs.main.appUrl}/keys-redirect/hiddify/${vpnKey.id}`,
      ) as unknown as ReturnType<typeof Markup.button.callback>,
      Markup.button.url(
        'HAPP',
        `${Envs.main.appUrl}/keys-redirect/happ/${vpnKey.id}`,
      ) as unknown as ReturnType<typeof Markup.button.callback>,
    ]);

    buttons.push([
      Markup.button.url(
        this.t(user, 'INCY'),
        `${Envs.main.appUrl}/keys-redirect/incy/${vpnKey.id}`,
      ) as unknown as ReturnType<typeof Markup.button.callback>,
    ]);

    if (vpnKey.status === 'expired')
      buttons.push([
        Markup.button.callback(
          `🗑️ ${this.t(user, 'delete_key')}`,
          `DELETE_KEY:${vpnKey.id}`,
        ),
      ]);

    buttons.push([
      Markup.button.callback(`⬅️ ${this.t(user, 'back')}`, 'BTN_5'),
    ]);

    await ctx
      .editMessageText(lines.join('\n'), {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons),
      })
      .catch(logger.error);
  }

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
    if (!priceResult.success && typeof priceResult.data === 'string') {
      const backCallback = isRenew ? `RENEW:${id}` : `T:${tariffId}`;
      await ctx
        .reply(`❌ ${this.t(user, priceResult.data)}`, {
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
      if (typeof priceResult.data !== 'string')
        await ctx
          .reply(
            `✅ ${this.t(user, 'promo_activated')}. ${this.t(user, 'price')}: <b>${this.transactionsService.formatNumber(await this.transactionsService.convert(priceResult.data.finalPrice, CurrencyEnum.RUB, this.t(user, 't11') as CurrencyEnum), this.t(user, 't10'))}</b>\n${this.t(user, 'click')} ${this.t(user, 'buy')}:`,
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
      if (typeof priceResult.data !== 'string')
        await ctx
          .reply(
            `✅ ${this.t(user, 'promo_activated')}. ${this.t(user, 'price')}: <b>${this.transactionsService.formatNumber(await this.transactionsService.convert(priceResult.data.finalPrice, CurrencyEnum.RUB, this.t(user, 't11') as CurrencyEnum), this.t(user, 't10'))}</b>\n${this.t(user, 'click')} ${this.t(user, 'buy')}:`,
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

  public async sendMessageAddBalance(
    userId: string,
    addBalance: number,
    currency: CurrencyEnum,
  ) {
    const user = await this.em.findOne(UserEntity, {
      where: { id: userId },
      relations: ['balanceAccount'],
    });
    if (!user?.telegramId) return;

    await bot.telegram
      .sendMessage(
        user.telegramId,
        `${this.t(user, 'improve_balance')} <b>${this.transactionsService.formatNumber(await this.transactionsService.convert(addBalance, currency, this.t(user, 't11') as CurrencyEnum), this.t(user, 't10'))}</b>`,
        { parse_mode: 'HTML' },
      )
      .catch(logger.error);

    const userKeyExists = await this.em.exists(UserKeyEntity, {
      where: { userId },
    });

    if (userKeyExists) {
      await bot.telegram
        .sendMessage(
          user.telegramId,
          `${this.t(user, 'select_action')}:`,
          this.profileMenu(user),
        )
        .catch(logger.error);

      return;
    }

    const tariffButtons = await this.tariffsButtons(user, 'base');
    const balance = await this.transactionsService.getUserTotalBalance(
      user.balanceAccount,
      this.t(user, 't11') as CurrencyEnum,
    );

    await bot.telegram
      .sendMessage(
        user.telegramId,
        `${this.t(user, 'balance')}: ${this.transactionsService.formatNumber(balance, this.t(user, 't10'))}\n<b>${this.t(user, 'select_tariff')}:</b>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            ...tariffButtons,
            [Markup.button.callback(`🌐️ ${this.t(user, 'menu')}`, 'BTN_1')],
          ]),
        },
      )
      .catch(logger.error);
  }

  public async sendRequestToBuyKey(user: UserEntity) {
    if (!user.telegramId) return;
    const filePath = path.join(
      __dirname,
      '../',
      '../',
      'public',
      'media',
      'welcome.mp4',
    );

    const videoMessage = await bot.telegram
      .sendVideo(user.telegramId, Input.fromLocalFile(filePath), {
        disable_notification: true,
      })
      .catch(() => {});
    if (!videoMessage) return;

    await bot.telegram
      .sendMessage(user.telegramId, this.t(user, 'message_try_first_key'), {
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
              Envs.telegram.supportProfile,
            ),
          ],
        ]),
      })
      .catch(logger.error);
  }

  public async sendAlmostExpiredKey(user: UserEntity) {
    if (!user.telegramId) return;
    const keys = this.prepareKeysToButtons(user, user.keys);

    await bot.telegram
      .sendMessage(
        user.telegramId,
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
      .where('users.telegramId IS NOT NULL')
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
      relations: ['user'],
    });
    const user = key.user;
    if (!user.telegramId) return;

    const buttons = this.prepareKeysToButtons(user, [key]);
    await bot.telegram.sendMessage(
      user.telegramId,
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

  public async sendMessageKeyTrafficLimitExceeded(keyId: string) {
    const key = await this.em.findOneOrFail(UserKeyEntity, {
      where: { id: keyId },
      relations: ['user'],
    });
    const user = key.user;
    if (!user.telegramId) return;

    const buttons = this.prepareKeysToButtons(user, [key]);
    await bot.telegram.sendMessage(
      user.telegramId,
      `${this.t(user, 'key_traffic_limit_exceeded')}\n` +
        `${this.t(user, 'select_action')}:`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          ...buttons,
          [Markup.button.callback(`⬅️ ${this.t(user, 'back')}`, 'BTN_2')],
        ]),
      },
    );
  }

  public async sendMessageKeyTrafficLow(keyId: string) {
    const key = await this.em.findOneOrFail(UserKeyEntity, {
      where: { id: keyId },
      relations: ['user'],
    });
    const user = key.user;
    if (!user.telegramId) return;

    const progress = this.xrayService.getPremiumTrafficProgress(key);
    if (!progress) return;

    const buttons = this.prepareKeysToButtons(user, [key]);
    await bot.telegram.sendMessage(
      user.telegramId,
      `${this.t(user, 'key_traffic_low_warning')}\n` +
        `<b>${this.t(user, 'traffic')}:</b> ${progress}\n\n` +
        `${this.t(user, 'select_action')}:`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          ...buttons,
          [Markup.button.callback(`⬅️ ${this.t(user, 'back')}`, 'BTN_2')],
        ]),
      },
    );
  }

  private getPayloadForAddBalance = (user: UserEntity) => {
    if (!user.telegramId) return;
    const amount = this.amountMap.get(user.telegramId);
    if (!amount) return;
    const text: string =
      `${this.t(user, 'deposit_amount')}: ${this.transactionsService.formatNumber(amount, this.t(user, 't10'))}\n` +
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
      [Markup.button.callback(`⭐ Telegram Stars`, 'ON_STARS')],
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

  private async tariffsButtons(
    user: UserEntity,
    kind: 'base' | 'premium' | 'cdn',
  ) {
    const where =
      kind === 'premium'
        ? { active: true, kind: 'cascade' as const }
        : kind === 'cdn'
          ? { active: true, kind: 'cdn' as const }
          : { active: true, kind: 'base' as const };

    const filteredList = await this.em.find(TariffEntity, {
      where,
      order: { price: 'ASC' },
    });

    const trialPromoCode =
      kind === 'premium'
        ? 'PREMIUM_TRIAL'
        : kind === 'cdn'
          ? 'VIP_TRIAL'
          : 'TRIAL';
    const hasUsedTrialPromo = await this.em
      .createQueryBuilder(PromoUsageEntity, 'usage')
      .innerJoin('usage.promoCode', 'promo')
      .where('usage.userId = :userId', { userId: user.id })
      .andWhere('promo.code = :trialPromoCode', {
        trialPromoCode,
      })
      .getExists();

    const pricedList = hasUsedTrialPromo
      ? filteredList.filter((t) => Number(t.price) > 0)
      : filteredList;

    return await Promise.all(
      pricedList.map(async (t) => {
        const vipDiscount =
          t.kind === 'cdn' ? this.getVipLaunchDiscount() : null;
        const displayPrice = vipDiscount
          ? Math.round(Number(t.price) * (1 - vipDiscount / 100))
          : Number(t.price);
        const formattedPrice = this.transactionsService.formatNumber(
          await this.transactionsService.convert(
            displayPrice,
            CurrencyEnum.RUB,
            this.t(user, 't11') as CurrencyEnum,
          ),
          this.t(user, 't10'),
        );
        let label = `${this.formatTariffLabel(user.languageCode, t)} — ${formattedPrice}`;
        if (vipDiscount) {
          const originalFormatted = this.transactionsService.formatNumber(
            await this.transactionsService.convert(
              Number(t.price),
              CurrencyEnum.RUB,
              this.t(user, 't11') as CurrencyEnum,
            ),
            this.t(user, 't10'),
          );
          const strikethrough = (s: string) =>
            [...s].map((c) => '\u0335' + c).join('');
          label = `🔥 ${this.formatTariffLabel(user.languageCode, t)} — ${strikethrough(originalFormatted)} ➡️ ${formattedPrice} (-${vipDiscount}%)`;
        }
        return [Markup.button.callback(label, `T:${t.id}`)];
      }),
    );
  }

  private formatTrafficLimit(limitBytes: string | number): string {
    const n = Number(limitBytes);
    if (!Number.isFinite(n) || n <= 0) return this.t('ru', 'unlimited');
    const gb = n / 1024 / 1024 / 1024;
    if (gb >= 1024) {
      const tb = Math.round((gb / 1024) * 10) / 10;
      return `${String(tb).replace('.', ',')} Tb`;
    }
    const gbRounded = Math.round(gb);
    return `${gbRounded} Gb`;
  }

  private formatTariffLabel(lang: string | undefined, t: TariffEntity): string {
    const limitBytes = t.trafficLimit ?? null;
    const isTrial = Number(t.price) === 0;
    const dayKey = `${isTrial ? 'tariff_trial_' : 'tariff_'}${t.expirationDays}`;
    if (limitBytes) {
      if (t.kind === 'cascade') {
        const template = this.t(lang ?? 'ru', 'premium_tariff_label');
        return template
          .replace('{days}', String(t.expirationDays))
          .replace('{traffic}', this.formatTrafficLimit(limitBytes));
      }

      // Обычный тариф с лимитом трафика: не показываем слово Premium.
      return `${this.t(lang ?? 'ru', dayKey)} (${this.formatTrafficLimit(limitBytes)})`;
    }
    return this.t(lang ?? 'ru', dayKey);
  }

  private prepareKeysToButtons(user: UserEntity, keys: UserKeyEntity[]) {
    return keys.map(({ id, expiresAt, status }, index) => {
      const expires = new Date(expiresAt).toLocaleDateString('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });

      const labelParts = [
        `${index + 1})`,
        this.t(user, status),
        `${this.t(user, 'until')}: ${expires}`,
      ];

      return [
        Markup.button.callback(labelParts.join(' • '), `KEY_DETAILS:${id}`),
      ];
    });
  }

  private setOpenAppButton = async (ctx: Context) => {
    if (!Envs.telegram.botWebUrl) return;
    const user = await this.getUserByCtx(ctx);

    await ctx.setChatMenuButton({
      type: 'web_app',
      text: this.t(user, 'open_app_button'),
      web_app: {
        url: Envs.telegram.botWebUrl,
      },
    });
  };

  public async resendMessage() {
    if (!resendMessageData || resendMessageData.started) return;
    resendMessageData.started = true;

    let query = this.em
      .createQueryBuilder(UserEntity, 'users')
      .where('users.telegramId IS NOT NULL')
      .andWhere('users.languageCode = :languageCode', {
        languageCode: resendMessageData.languageCode,
      });

    if (!resendMessageData.sendToAll) {
      query = query.innerJoin('users.keys', 'keys', "keys.status = 'active'");
    }

    const users = await query.getMany();

    for (const user of users) {
      try {
        if (!user.telegramId) continue;
        await bot.telegram
          .copyMessage(
            user.telegramId,
            resendMessageData.chatId,
            resendMessageData.messageId,
            { disable_notification: true },
          )
          .catch(() => {});

        await bot.telegram
          .sendMessage(user.telegramId, `${this.t(user, 'select_action')}:`, {
            ...this.menu(user),
          })
          .catch(() => {});
        await bot.telegram.setChatMenuButton({
          chatId: user.telegramId,
          menuButton: {
            type: 'web_app',
            text: this.t(user, 'open_app_button'),
            web_app: {
              url: Envs.telegram.botWebUrl!,
            },
          },
        });

        await new Promise((r) => setTimeout(r, 100));
      } catch (e) {
        logger.error(e);
      }
    }

    resendMessageData = undefined;
  }

  private saveResendMessage = async (ctx: Context) => {
    if (ctx.from?.id !== 904644377 && ctx.from?.id !== 871909427) return;
    const user = await this.getUserByCtx(ctx);
    if (!user.telegramId) return;

    const ctxMessage = ctx.message as {
      message_id: number;
      text?: string;
      reply_to_message?: { message_id: number };
    };
    const message = ctxMessage.reply_to_message;
    if (!message) {
      return ctx.reply(this.t(user, 'need_to_reply'));
    }

    const sendToAll = (ctxMessage.text ?? '').includes('all');

    resendMessageData = {
      started: false,
      languageCode: user.languageCode,
      chatId: user.telegramId,
      messageId: message.message_id,
      sendToAll,
    };
  };
}
