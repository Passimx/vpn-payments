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
    if (!id) return;

    return this.authService.deleteKey(id);
  };

  private extendKey = async (ctx: Context<ExtendKeyDto>) => {
    const payload = ctx.payload;
    if (!payload) return;

    return this.authService.extendKey(payload);
  };

  private createKey = async (ctx: Context<UserKeyEntity>) => {
    const key = ctx.payload;
    if (!key) return;

    return this.authService.createKey(key.userId, key.tariffId);
  };

  private getTariffs = async () => {
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

    return GetTariffsDto.creteInstance(base, cdn);
  };

  private updateUserInf = async (ctx: Context<Partial<UserEntity>>) => {
    const user = ctx.payload;
    if (!user.id) return;

    await this.em.update(
      UserEntity,
      { id: user.id },
      { languageCode: user.languageCode },
    );

    return this.authService.getUser(user.id);
  };

  private getUserInf = async (ctx: Context<string>) => {
    const id = ctx.payload;
    if (!id.length) return;

    return this.authService.getUser(id);
  };

  private loginByUrl = async (ctx: Context<string>) => {
    const pattern =
      /\/keys-info\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/;

    const match = ctx.payload.match(pattern);
    const id = match ? match[1] : null;
    if (!id) return;

    const key = await this.em.findOne(UserKeyEntity, {
      where: { id },
      relations: ['user'],
    });
    if (!key) return;

    return this.authService.getUser(key.userId);
  };

  private createAccount = async (ctx: Context<{ languageCode: string }>) => {
    if (!ctx.payload?.languageCode) return;

    return this.authService.createAccount(ctx.payload);
  };

  private createWechatInvoice = async (ctx: Context<CreateInvoiceType>) => {
    const payload = ctx.payload;
    if (!payload) return;

    return this.invoicesService.getWechatInvoice(
      payload.userId,
      payload.amount,
    );
  };

  private createSberInvoice = async (ctx: Context<CreateInvoiceType>) => {
    const payload = ctx.payload;
    if (!payload) return;

    return this.invoicesService.getSberInvoice(payload.userId, payload.amount);
  };

  private createTonInvoice = (ctx: Context<CreateTonInvoiceType>) => {
    const payload = ctx.payload;
    if (!payload) return;

    return this.invoicesService.getTonInvoice(
      payload.userId,
      payload.amount,
      payload.currency,
      payload.app,
    );
  };

  private getCurrency = () => {
    return this.transactionsService.getCurrencyPrice();
  };

  private getApps = () => {
    return TelegramService.downloadLinks;
  };
}

export default PxConnectService;
