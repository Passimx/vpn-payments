import { Injectable } from '@nestjs/common';
import { Context, Markup, Telegraf } from 'telegraf';

import { EntityManager } from 'typeorm';
import { UserEntity } from '../database/entities/user.entity';
import { TransactionEntity } from '../database/entities/transaction.entity';
import { Envs } from '../../common/env/envs';

@Injectable()
export class TelegramService {
  private bot: Telegraf;

  constructor(private readonly em: EntityManager) {}

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
    this.bot.launch();
  }

  onModuleDestroy() {
    this.bot.stop();
  }

  onStart = async (ctx: Context) => {
    await ctx.reply('Выбери действие:', this.initMenu);
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
        `ID: ${user.id}\nБаланс: ${user?.balance ?? 0} руб.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🔑 Мои ключи ', 'BTN_5')],
          [Markup.button.callback('💸 Пополнить баланс ', 'BTN_7')],
          [Markup.button.callback('📋 История пополнений ', 'BTN_6')],
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
    const telegramId = ctx?.from?.id;
    const user = await this.em.findOne(UserEntity, {
      where: { telegramId },
    });
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
    await ctx
      .editMessageText(
        'Выбери действие:',
        Markup.inlineKeyboard([
          [
            Markup.button.url('📱 Android', 'https://passimx.ru'),
            Markup.button.url('📱 IOS', 'https://passimx.ru'),
          ],
          [
            Markup.button.url('💻 Windows', 'https://passimx.ru'),
            Markup.button.url('💻 MacOS', 'https://passimx.ru'),
          ],
          [this.backToMenuButton],
        ]),
      )
      .catch(() => {});
  };

  onBtn5 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
    await ctx
      .editMessageText(
        'Выбери действие:',
        Markup.inlineKeyboard([[this.backToProfileButton]]),
      )
      .catch(() => {});
  };

  onBtn6 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
    const telegramId = ctx?.from?.id;

    const transactionArrays: any[][] = [];
    const transactions = await this.em.find(TransactionEntity, {
      where: { user: { telegramId } },
      order: { createdAt: 'DESC' },
      take: 10,
    });

    const step = 2;
    for (let i = 0; i < transactions.length; i += step) {
      const array: any[] = [];
      for (let j = i; j < i + step; j++) {
        if (transactions[j])
          array.push(
            Markup.button.callback(
              `${transactions[j].amount} ${transactions[j].currency} (${new Date(transactions[j].createdAt).toLocaleDateString('ru-RU')})`,
              transactions[j].message,
            ),
          );
      }
      transactionArrays.push(array);
    }

    await ctx
      .editMessageText(
        '10 последних пополнений',
        Markup.inlineKeyboard([
          ...transactionArrays,
          [this.backToProfileButton],
        ]),
      )
      .catch(() => {});
  };

  onBtn7 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
    await ctx
      .editMessageText(
        'Выбери действие:',
        Markup.inlineKeyboard([
          [
            Markup.button.callback('📲 СБП ', 'BTN_3'),
            Markup.button.callback('💎 ТОН ', 'BTN_8'),
          ],
          [this.backToProfileButton],
        ]),
      )
      .catch(() => {});
  };

  onBtn8 = async (ctx: Context) => {
    ctx.answerCbQuery().catch(() => {});
    const telegramId = ctx?.from?.id;
    const user = await this.em.findOne(UserEntity, {
      where: { telegramId },
    });
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
}
