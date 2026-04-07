const endColor = '\x1B[0m'; // ansi color escape codes
const infoColor = '\x1B[34m';
const errorColor = '\x1B[31m';
const debugColor = '\x1B[33m';

const log = (level: string, msg?: unknown, ...optionalParams: unknown[]) => {
  let prefix = `${infoColor}info:${endColor}`;

  switch (level) {
    case 'error':
      prefix = `${errorColor}error:${endColor}`;
      break;
    case 'debug':
      prefix = `${debugColor}debug:${endColor}`;
      break;
  }

  console.log(prefix, msg, ...optionalParams);
};

export const logger = {
  info: (msg?: unknown, ...optionalParams: unknown[]) =>
    log('info', msg, ...optionalParams),
  error: (msg?: unknown, ...optionalParams: unknown[]) =>
    log('error', msg, ...optionalParams),
  debug: (msg?: unknown, ...optionalParams: unknown[]) =>
    log('debug', msg, ...optionalParams),
};
