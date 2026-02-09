export type GlobalResponseType<T> = {
  resultCode: 'OK';
  trackingId: string;
  payload: T;
};
