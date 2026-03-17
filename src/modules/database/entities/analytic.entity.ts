import { Column, Entity } from 'typeorm';

@Entity({ name: 'analytics' })
export class AnalyticEntity {
  @Column({ primary: true, type: 'timestamptz', name: 'created_at' })
  readonly createdAt: Date;

  @Column({ name: 'all_users_count', type: 'int' })
  readonly allUsersCount: number;

  @Column({ name: 'new_users_count', type: 'int' })
  readonly newUsersCount: number;

  @Column({ name: 'active_users_count', type: 'int' })
  readonly activeUsersCount: number;

  @Column({ name: 'payments_sum', type: 'int' })
  readonly paymentsSum: number;

  @Column({ name: 'active_keys_count', type: 'int' })
  readonly activeKeysCount: number;
}
