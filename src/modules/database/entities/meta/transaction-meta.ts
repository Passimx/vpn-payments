export class TransactionMeta {
  readonly paymentId?: string;

  readonly place: 'ton' | 'yookassa' | 'wechat' | 'telegram';
}
