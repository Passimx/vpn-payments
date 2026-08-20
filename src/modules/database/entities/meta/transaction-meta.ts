export class TransactionMeta {
  readonly paymentId?: string;

  readonly paymentUrl?: string;

  readonly place: 'ton' | 'yookassa' | 'wechat' | 'telegram';
}
