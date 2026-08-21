export class DepositMeta {
  readonly paymentId?: string;

  readonly place: 'ton' | 'yookassa' | 'wechat' | 'telegram';
}
