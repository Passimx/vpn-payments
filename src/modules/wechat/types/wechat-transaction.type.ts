export type WechatTransactionType = {
  mchid: string;
  appid: string;
  out_trade_no: string;
  transaction_id: string;
  trade_type: string;
  trade_state: string;
  trade_state_desc: string;
  bank_type: string;
  attach: string;
  success_time: Date;
  payer: { openid: string };
  amount: {
    total: number;
    payer_total: number;
    currency: 'CNY';
    payer_currency: 'CNY';
  };
};
