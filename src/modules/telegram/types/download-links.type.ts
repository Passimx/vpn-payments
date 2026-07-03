export enum DownloadLinksItemKeys {
  HAPP = 'happ',
  HIDDIFY = 'hiddify',
  INCY = 'incy',
}

export enum KeyEnum {
  ANDROID = 'android',
  IOS = 'ios',
  WINDOWS = 'windows',
}

type DownloadLinksItem = {
  [key in DownloadLinksItemKeys]: string;
};

export type DownloadLinksType = {
  [key in KeyEnum]: DownloadLinksItem;
};
