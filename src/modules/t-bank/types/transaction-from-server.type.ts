export type TransactionFromServerType = {
  id: number;
  operationTime: {
    milliseconds: number;
  };
  type: 'Credit' | 'Debit';
  status: 'OK';
  amount: {
    value: number;
    currency: {
      code: number;
      name: 'RUB';
    };
  };
  message: string;
};
