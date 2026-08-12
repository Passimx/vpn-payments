import { Injectable } from '@nestjs/common';
import { Envs } from '../../common/env/envs';
import { EventsEnum } from './types/events.enum';
import { TransactionsService } from '../transactions/transactions.service';
import { InvoicesService } from '../transactions/invoices.service';
import { TelegramService } from '../telegram/telegram-service';
import { CreateTonInvoiceType } from './types/create-ton-invoice.type';
import { CreateInvoiceType } from './types/create-invoice.type';
import { PxConnect, Context } from './import';
import { AuthService } from '../api/services/auth.service';
import { EntityManager } from 'typeorm';
import { UserKeyEntity } from '../database/entities/user-key.entity';
import { UserEntity } from '../database/entities/user.entity';
import { TariffEntity } from '../database/entities/tariff.entity';
import { GetTariffsDto } from '../api/dto/requests/get-tariffs.dto';
import { ExtendKeyDto } from '../api/dto/requests/extend-key.dto';

@Injectable()
class PxConnectService {
  private readonly px: PxConnect;

  constructor(
    private readonly em: EntityManager,
    private readonly authService: AuthService,
    private readonly invoicesService: InvoicesService,
    private readonly transactionsService: TransactionsService,
  ) {
    this.px = new PxConnect(Envs.passimxConnect.url);
    this.px.on('connect', this.onConnection);
    this.px.connect();
  }

  private onConnection = async () => {
    await this.px.createChannel({
      exportInit: Envs.passimxConnect.exportInit,
    });

    this.px.onAction((routes) => {
      routes.on(EventsEnum.GET_APPS, this.getApps);
      routes.on(EventsEnum.CREATE_KEY, this.createKey);
      routes.on(EventsEnum.EXTEND_KEY, this.extendKey);
      routes.on(EventsEnum.REMOVE_KEY, this.removeKey);
      routes.on(EventsEnum.GET_TARIFFS, this.getTariffs);
      routes.on(EventsEnum.LOGIN_BY_URL, this.loginByUrl);
      routes.on(EventsEnum.GET_USER_INF, this.getUserInf);
      routes.on(EventsEnum.GET_CURRENCY, this.getCurrency);
      routes.on(EventsEnum.CREATE_ACCOUNT, this.createAccount);
      routes.on(EventsEnum.UPDATE_USER_INF, this.updateUserInf);
      routes.on(EventsEnum.CREATE_TON_INVOICE, this.createTonInvoice);
      routes.on(EventsEnum.CREATE_SBER_INVOICE, this.createSberInvoice);
      routes.on(EventsEnum.CREATE_WECHAT_INVOICE, this.createWechatInvoice);
    });
  };

  private readonly removeKey = async (ctx: Context<string>) => {
    const id = ctx.payload;
    if (!id) return ctx.reply(undefined);

    const result = await this.authService.deleteKey(id);
    ctx.reply(result);
  };

  private extendKey = async (ctx: Context<ExtendKeyDto>) => {
    const payload = ctx.payload;
    if (!payload) return ctx.reply(undefined);

    const result = await this.authService.extendKey(payload);
    ctx.reply(result);
  };

  private createKey = async (ctx: Context<UserKeyEntity>) => {
    const key = ctx.payload;
    if (!key) return ctx.reply(undefined);

    const result = await this.authService.createKey(key.userId, key.tariffId);
    ctx.reply(result);
  };

  private getTariffs = async (ctx: Context) => {
    const [base, cdn] = await Promise.all([
      this.em.find(TariffEntity, {
        where: { active: true, kind: 'base' },
        order: { price: 'ASC' },
      }),
      this.em.find(TariffEntity, {
        where: { active: true, kind: 'cdn' },
        order: { price: 'ASC' },
      }),
    ]);

    ctx.reply(GetTariffsDto.creteInstance(base, cdn));
  };

  private updateUserInf = async (ctx: Context<Partial<UserEntity>>) => {
    const user = ctx.payload;
    if (!user.id) return ctx.reply(undefined);

    await this.em.update(
      UserEntity,
      { id: user.id },
      { languageCode: user.languageCode },
    );

    const updatedUser = await this.authService.getUser(user.id);
    ctx.reply(updatedUser);
  };

  private getUserInf = async (ctx: Context<string>) => {
    const id = ctx.payload;
    if (!id.length) return ctx.reply(undefined);

    const user = await this.authService.getUser(id);
    ctx.reply(user);
  };

  private loginByUrl = async (ctx: Context<string>) => {
    const pattern =
      /\/keys-info\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/;

    const match = ctx.payload.match(pattern);
    const id = match ? match[1] : null;
    if (!id) return ctx.reply(undefined);

    const key = await this.em.findOne(UserKeyEntity, {
      where: { id },
      relations: ['user'],
    });
    if (!key) return ctx.reply(undefined);

    const user = await this.authService.getUser(key.userId);
    ctx.reply({ user });
  };

  private createAccount = async (ctx: Context<{ languageCode: 'ru' }>) => {
    const response = await this.authService.createAccount(ctx.payload);
    ctx.reply(response);
  };

  private createWechatInvoice = async (ctx: Context<CreateInvoiceType>) => {
    const payload = ctx.payload;
    if (!payload) return ctx.reply(undefined);

    const response = await this.invoicesService.getWechatInvoice(
      payload.userId,
      payload.amount,
    );
    ctx.reply(response);
  };

  private createSberInvoice = async (ctx: Context<CreateInvoiceType>) => {
    const payload = ctx.payload;
    if (!payload) return ctx.reply(undefined);

    const response = await this.invoicesService.getSberInvoice(
      payload.userId,
      payload.amount,
    );
    ctx.reply(response);
  };

  private createTonInvoice = (ctx: Context<CreateTonInvoiceType>) => {
    const payload = ctx.payload;
    if (!payload) return ctx.reply(undefined);

    const response = this.invoicesService.getTonInvoice(
      payload.userId,
      payload.amount,
      payload.currency,
      payload.app,
    );

    ctx.reply(response);
  };

  private getCurrency = async (ctx: Context) => {
    const response = await this.transactionsService.getCurrencyPrice();
    ctx.reply(response);
  };

  private getApps = (ctx: Context) => {
    ctx.reply(TelegramService.downloadLinks);
  };
}

export default PxConnectService;
