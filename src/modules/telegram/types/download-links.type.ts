export enum DownloadLinksItemKeys {
  HAPP = 'happ',
  HIDDIFY = 'hiddify',
  INCY = 'incy',
  V2_RAY_TUN = 'v2RayTun',
}

export enum KeyEnum {
  ANDROID = 'android',
  IOS = 'ios',
}

type DownloadLinksItem = {
  [key in DownloadLinksItemKeys]: string;
};

export type DownloadLinksType = {
  [key in KeyEnum]: DownloadLinksItem;
};
