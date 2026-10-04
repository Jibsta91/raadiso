import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '../config.js';
import type { Valkey } from '../infra/clients.js';
import { APP_CONFIG, VALKEY } from '../tokens.js';

export interface SessionUser {
  id: string;
  email: string;
  name?: string;
  locale: string;
  roles: string[];
}

export interface SessionData {
  user: SessionUser;
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  /** Epoch seconds. */
  accessExpiresAt: number;
  createdAt: number;
}

export interface LoginTransaction {
  codeVerifier: string;
  nonce: string;
  returnTo: string;
}

/**
 * Server-side sessions in Valkey. The browser only holds an opaque 256-bit id;
 * Valkey keys are SHA-256 of that id and values are AES-256-GCM encrypted, so
 * neither a cache dump nor a stolen key name yields usable tokens.
 */
@Injectable()
export class SessionStore {
  constructor(
    @Inject(VALKEY) private readonly valkey: Valkey,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  newId(): string {
    return randomBytes(32).toString('base64url');
  }

  async create(data: SessionData, ttlSec: number): Promise<string> {
    const id = this.newId();
    await this.save(id, data, ttlSec);
    return id;
  }

  async save(id: string, data: SessionData, ttlSec: number): Promise<void> {
    const key = this.key(id);
    const maxRemaining =
      data.createdAt + this.cfg.env.SESSION_MAX_AGE_SEC - Math.floor(Date.now() / 1000);
    const ttl = Math.max(1, Math.min(ttlSec, maxRemaining));
    await this.valkey.set(key, this.encrypt(JSON.stringify(data), key), 'EX', ttl);
  }

  async get(id: string | undefined): Promise<SessionData | null> {
    if (!id || !/^[\w-]{43}$/.test(id)) return null;
    const key = this.key(id);
    const raw = await this.valkey.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(this.decrypt(raw, key)) as SessionData;
    } catch {
      await this.valkey.del(key);
      return null;
    }
  }

  async destroy(id: string | undefined): Promise<void> {
    if (id) await this.valkey.del(this.key(id));
  }

  /** Serialises token refreshes per session (refresh tokens are single-use). */
  async withRefreshLock<T>(id: string, fn: () => Promise<T>): Promise<T | null> {
    const lock = `${this.key(id)}:refresh-lock`;
    const acquired = await this.valkey.set(lock, '1', 'PX', 10_000, 'NX');
    if (!acquired) return null;
    try {
      return await fn();
    } finally {
      await this.valkey.del(lock);
    }
  }

  async putLoginTransaction(state: string, tx: LoginTransaction): Promise<void> {
    const key = `bff:login:${state}`;
    await this.valkey.set(key, this.encrypt(JSON.stringify(tx), key), 'EX', 600);
  }

  /** Single use: the transaction is deleted when read (replay protection). */
  async takeLoginTransaction(state: string): Promise<LoginTransaction | null> {
    if (!/^[\w-]{16,128}$/.test(state)) return null;
    const key = `bff:login:${state}`;
    const raw = await this.valkey.getdel(key);
    if (!raw) return null;
    try {
      return JSON.parse(this.decrypt(raw, key)) as LoginTransaction;
    } catch {
      return null;
    }
  }

  private key(id: string): string {
    return `${this.cfg.env.SESSION_KEY_PREFIX}:sess:${createHash('sha256').update(id).digest('hex')}`;
  }

  encrypt(plaintext: string, aad: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.cfg.secrets.sessionKey, iv);
    cipher.setAAD(Buffer.from(aad));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
  }

  decrypt(payload: string, aad: string): string {
    const buf = Buffer.from(payload, 'base64url');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.cfg.secrets.sessionKey,
      buf.subarray(0, 12),
    );
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  }
}
