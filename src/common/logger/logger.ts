const endColor = '\x1B[0m'; // ansi color escape codes
const infoColor = '\x1B[34m';
const errorColor = '\x1B[31m';
const debugColor = '\x1B[33m';
const timeColor = '\x1B[90m';

const log = (level: string, msg?: unknown, ...optionalParams: unknown[]) => {
  let prefix = `${infoColor}Info${endColor}`;
  const time = getTimeString();

  switch (level) {
    case 'error':
      prefix = `${errorColor}Error${endColor}`;
      break;
    case 'debug':
      prefix = `${debugColor}Debug${endColor}`;
      break;
  }

  console.log(`[${prefix}]`, time, msg, ...optionalParams);
};

export const logger = {
  info: (msg?: unknown, ...optionalParams: unknown[]) =>
    log('info', msg, ...optionalParams),
  error: (msg?: unknown, ...optionalParams: unknown[]) =>
    log('error', msg, ...optionalParams),
  debug: (msg?: unknown, ...optionalParams: unknown[]) =>
    log('debug', msg, ...optionalParams),
};

export const getTimeString = () => {
  const now = new Date();
  const timeStr = now.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  const offsetMinutes = -now.getTimezoneOffset();
  const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offsetStr = `UTC${sign}${offsetHours}`;

  return `${timeColor}[${timeStr} ${offsetStr}]${endColor}`;
};
