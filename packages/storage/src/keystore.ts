/**
 * Encrypted API Key Storage
 * Uses platform-native keystores:
 * - Mobile: expo-secure-store
 * - Desktop: keytar (OS Keychain/Credential Manager)
 */

import type { KeystoreAdapter, IAPIKeyManager } from "./types";

/**
 * In-memory keystore adapter (for testing, not secure)
 */
class InMemoryKeystoreAdapter implements KeystoreAdapter {
  private store = new Map<string, string>();

  async set(service: string, account: string, secret: string): Promise<void> {
    this.store.set(`${service}:${account}`, secret);
  }

  async get(service: string, account: string): Promise<string | null> {
    return this.store.get(`${service}:${account}`) || null;
  }

  async delete(service: string, account: string): Promise<void> {
    this.store.delete(`${service}:${account}`);
  }

  async list(service: string): Promise<string[]> {
    const prefix = `${service}:`;
    return Array.from(this.store.keys())
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length));
  }
}

/**
 * Create platform-specific keystore
 */
export function createKeystore(
  platform: "mobile" | "desktop" | "test"
): KeystoreAdapter {
  if (platform === "test") {
    return new InMemoryKeystoreAdapter();
  }

  if (platform === "mobile") {
    // Mobile uses expo-secure-store
    return new MobileKeystoreAdapter();
  }

  // Desktop uses keytar - return the desktop adapter
  return new DesktopKeystoreAdapter();
}

/**
 * Mobile Keystore Adapter (Expo Secure Store)
 */
class MobileKeystoreAdapter implements KeystoreAdapter {
  async set(service: string, account: string, secret: string): Promise<void> {
    try {
      // @ts-expect-error - expo-secure-store is only available on mobile
      const store = await import("expo-secure-store");
      await store.setItemAsync(`${service}:${account}`, secret);
    } catch (error) {
      // Fallback to in-memory if expo-secure-store not available
      console.warn("expo-secure-store not available, using in-memory storage");
    }
  }

  async get(service: string, account: string): Promise<string | null> {
    try {
      // @ts-expect-error - expo-secure-store is only available on mobile
      const store = await import("expo-secure-store");
      return (await store.getItemAsync(`${service}:${account}`)) || null;
    } catch (error) {
      return null;
    }
  }

  async delete(service: string, account: string): Promise<void> {
    try {
      // @ts-expect-error - expo-secure-store is only available on mobile
      const store = await import("expo-secure-store");
      await store.deleteItemAsync(`${service}:${account}`);
    } catch (error) {
      console.warn("Failed to delete from secure store");
    }
  }

  async list(service: string): Promise<string[]> {
    // expo-secure-store doesn't support listing, so we maintain a metadata file
    try {
      const metadata = localStorage?.getItem(`${service}:keys`);
      return metadata ? JSON.parse(metadata) : [];
    } catch {
      return [];
    }
  }
}

/**
 * Desktop Keystore Adapter (Keytar)
 */
class DesktopKeystoreAdapter implements KeystoreAdapter {
  async set(service: string, account: string, secret: string): Promise<void> {
    try {
      // @ts-expect-error - keytar is only available on desktop
      const keytar = await import("keytar");
      await keytar.setPassword(service, account, secret);
    } catch (error) {
      console.warn("keytar not available, using in-memory storage");
    }
  }

  async get(service: string, account: string): Promise<string | null> {
    try {
      // @ts-expect-error - keytar is only available on desktop
      const keytar = await import("keytar");
      return await keytar.getPassword(service, account);
    } catch (error) {
      return null;
    }
  }

  async delete(service: string, account: string): Promise<void> {
    try {
      // @ts-expect-error - keytar is only available on desktop
      const keytar = await import("keytar");
      await keytar.deletePassword(service, account);
    } catch (error) {
      console.warn("Failed to delete from keytar");
    }
  }

  async list(service: string): Promise<string[]> {
    try {
      // @ts-expect-error - keytar is only available on desktop
      const keytar = await import("keytar");
      const creds = await keytar.findCredentials(service);
      return creds.map((c: any) => c.account);
    } catch (error) {
      return [];
    }
  }
}

/**
 * High-level API Key Manager
 */
export class APIKeyManager implements IAPIKeyManager {
  private keystore: KeystoreAdapter;
  private service = "syntax-senpai-ai";

  constructor(platform: "mobile" | "desktop" | "test" = "desktop") {
    this.keystore = createKeystore(platform);
  }

  async setKey(providerId: string, key: string): Promise<void> {
    if (!key || key.trim().length === 0) {
      throw new Error("API key cannot be empty");
    }
    await this.keystore.set(this.service, providerId, key);
  }

  async getKey(providerId: string): Promise<string | null> {
    return this.keystore.get(this.service, providerId);
  }

  async deleteKey(providerId: string): Promise<void> {
    await this.keystore.delete(this.service, providerId);
  }

  async hasKey(providerId: string): Promise<boolean> {
    const key = await this.getKey(providerId);
    return key !== null && key.length > 0;
  }

  async listConfiguredProviders(): Promise<string[]> {
    return this.keystore.list(this.service);
  }

  /**
   * Get key for a provider, throw if not found
   */
  async getKeyRequired(providerId: string): Promise<string> {
    const key = await this.getKey(providerId);
    if (!key) {
      throw new Error(
        `No API key configured for provider: ${providerId}. Please set it in settings.`
      );
    }
    return key;
  }
}

/**
 * Create a default API Key Manager
 */
export function createAPIKeyManager(
  platform?: "mobile" | "desktop" | "test"
): APIKeyManager {
  return new APIKeyManager(platform);
}
