import { Injectable } from '@nestjs/common';
import zh from './languages/zh';
import ru from './languages/ru';
import en from './languages/en';

export type Dictionary = Record<string, string>;

@Injectable()
export class I18nService {
  public readonly langs: Record<string, Dictionary> = {
    ru,
    en,
    zh,
  };

  t(lang: string = 'en', key: string): string {
    const normalized = lang?.toLowerCase().split('-')[0]; // zh-hans -> zh
    const locale = this.langs[normalized] ?? this.langs.en;
    return locale[key] ?? key;
  }
}
