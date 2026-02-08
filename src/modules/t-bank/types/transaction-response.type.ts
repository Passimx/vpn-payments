import { TransactionFromServerType } from './transaction-from-server.type';

export type TransactionResponseType =
  | TransactionSuccessResponseType
  | TransactionUnSuccessResponseType;

export type TransactionSuccessResponseType = {
  resultCode: 'OK';
  trackingId: string;
  payload: TransactionFromServerType[];
};

export type TransactionUnSuccessResponseType = {
  resultCode: 'AUTHENTICATION_FAILED';
  trackingId: string;
  details: {
    errorId: string;
    errorCode: 'INSUFFICIENT_PRIVILEGES';
    httpStatusCode: 401;
  };
};
