import { Injectable } from '@nestjs/common';
import { Envs } from '../../common/env/envs';

type BlitzServicesStatus = {
  hysteria_server?: boolean;
  hysteria_webpanel?: boolean;
  hysteria_telegram_bot?: boolean;
  [key: string]: boolean | undefined;
};

type BlitzUserUriResponse = {
  username: string;
  ipv4?: string | null;
  ipv6?: string | null;
  nodes?: Array<{ name: string; uri: string }> | null;
  normal_sub?: string | null;
  error?: string | null;
};

@Injectable()
export class BlitzService {
  private get baseUrl(): string {
    const url = Envs.blitz.apiUrl.replace(/\/$/, '');
    return url.endsWith('/api/v1') ? url : `${url}/api/v1`;
  }

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: Envs.blitz.apiKey,
    };
  }

  async checkConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/server/services/status`, {
        headers: this.headers,
      });
      if (!res.ok) return false;
      const data = (await res.json()) as BlitzServicesStatus;
      return data.hysteria_server === true;
    } catch {
      return false;
    }
  }

  async createUserKey(params: {
    username: string;
    trafficLimitGb: number;
    expirationDays: number;
    isUnlimited: boolean;
    note?: string;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const body = {
        username: params.username,
        traffic_limit: params.trafficLimitGb,
        expiration_days: params.expirationDays,
        unlimited: params.isUnlimited,
        note: params.note ?? null,
      };

      const res = await fetch(`${this.baseUrl}/users/`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.text();
        return { success: false, error: err || `HTTP ${res.status}` };
      }
      return { success: true };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
      };
    }
  }

  async getUserKeyUri(username: string): Promise<{
    success: boolean;
    uri?: string;
    normalSub?: string;
    error?: string;
  }> {
    try {
      const res = await fetch(
        `${this.baseUrl}/users/${encodeURIComponent(username)}/uri`,
        { headers: this.headers },
      );

      if (!res.ok) {
        const err = await res.text();
        return { success: false, error: err || `HTTP ${res.status}` };
      }

      const data = (await res.json()) as BlitzUserUriResponse;
      if (data.error) {
        return { success: false, error: data.error };
      }

      const uri =
        data.normal_sub ?? data.ipv4 ?? data.ipv6 ?? data.nodes?.[0]?.uri;
      return {
        success: true,
        uri: uri ?? undefined,
        normalSub: data.normal_sub ?? undefined,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
      };
    }
  }

  async editUser(params: {
    username: string;
    expirationDays?: number;
    trafficLimitGb?: number;
    renewCreationDate?: boolean;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const body: Record<string, unknown> = {};
      if (params.expirationDays !== undefined) {
        body.new_expiration_days = params.expirationDays;
      }
      if (params.trafficLimitGb !== undefined) {
        body.new_traffic_limit = params.trafficLimitGb;
      }
      if (params.renewCreationDate !== undefined) {
        body.renew_creation_date = params.renewCreationDate;
      }

      const res = await fetch(
        `${this.baseUrl}/users/${encodeURIComponent(params.username)}`,
        {
          method: 'PATCH',
          headers: this.headers,
          body: JSON.stringify(body),
        },
      );

      if (!res.ok) {
        const err = await res.text();
        return { success: false, error: err || `HTTP ${res.status}` };
      }
      return { success: true };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
      };
    }
  }
}
