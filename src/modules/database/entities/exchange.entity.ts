import { Column, Entity } from 'typeorm';

@Entity('exchanges')
export class ExchangeEntity {
  @Column({
    type: 'bigint',
    primary: true,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => Number(value),
    },
  })
  readonly date: number;

  @Column({ name: 'currency', type: 'varchar', default: 2 ** 8, primary: true })
  readonly currency: 'TON' | 'USD' | 'РУБ';

  @Column({
    name: 'balance',
    type: 'numeric',
    transformer: {
      to: (value: number) => value,
      from: (value: string) => Number(value),
    },
    default: 0,
  })
  readonly price: number;

  @Column({
    name: 'price_currency',
    type: 'varchar',
    default: 2 ** 8,
    primary: true,
  })
  readonly priceCurrency: 'USD' | 'РУБ' | 'CNY';
}
