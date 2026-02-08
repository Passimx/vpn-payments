import { Column, Entity } from 'typeorm';

@Entity({ name: 't_bank_info' })
export class TBankEntity {
  @Column({ name: 'wuid', type: 'text', primary: true })
  readonly wuid: string;

  @Column({ name: 'cookie', type: 'text' })
  readonly cookie: string;

  @Column({ name: 'session_id', type: 'text' })
  readonly sessionId: string;
}
