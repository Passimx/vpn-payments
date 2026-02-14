const BASE_URL = 'https://yoomoney.ru/quickpay/confirm.xml';

export function buildQuickpayUrl(params: {
  receiver: string;
  sum: number;
  targets?: string;
  paymentType?: string;
  label?: string;
}): string {
  const p = new URLSearchParams();
  p.set('receiver', params.receiver);
  p.set('quickpay-form', 'shop');
  p.set('sum', params.sum.toString());
  if (params.targets) p.set('targets', params.targets);
  if (params.paymentType) p.set('paymentType', params.paymentType);
  if (params.label) p.set('label', params.label);
  return `${BASE_URL}?${p.toString()}`;
}
