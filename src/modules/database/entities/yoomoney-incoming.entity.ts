import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'yoomoney_incoming' })
export class YooMoneyIncomingEntity {
  @PrimaryColumn({ name: 'operation_id', type: 'varchar' })
  readonly operationId: string;

  @Column({ name: 'amount', type: 'numeric' })
  readonly amount: number;

  @Column({ name: 'datetime', type: 'timestamptz' })
  readonly datetime: Date;

  @Column({ name: 'label', type: 'varchar', nullable: true })
  readonly label: string | null;

  @Column({ name: 'title', type: 'varchar', nullable: true })
  readonly title: string | null;

  @Column({ name: 'status', type: 'varchar' })
  readonly status: string;
}
