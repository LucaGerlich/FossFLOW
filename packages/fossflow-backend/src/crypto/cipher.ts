import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { deriveKey } from './master-key.js';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Wrong key, tampered or unknown data. Never carries the data itself. */
export class DecryptionError extends Error {
  override name = 'DecryptionError';
  constructor() {
    super('Stored credential data could not be decrypted (wrong encryption key, or damaged data)');
  }
}

export interface Cipher {
  encrypt(value: unknown): string;
  decrypt(sealed: string): unknown;
}

/**
 * Seals credential data with AES-256-GCM: `v1:` + base64(iv | tag | ciphertext).
 * The key is derived from the master key for this purpose only; the version
 * prefix leaves room for key rotation later.
 */
export function createCipher(masterKey: Buffer): Cipher {
  const key = deriveKey(masterKey, 'credentials-v1');

  return {
    encrypt(value) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')}`;
    },

    decrypt(sealed) {
      const [version, payload] = sealed.split(':', 2);
      if (version !== VERSION || !payload) throw new DecryptionError();
      const bytes = Buffer.from(payload, 'base64');
      if (bytes.length < IV_BYTES + TAG_BYTES) throw new DecryptionError();
      try {
        const decipher = createDecipheriv(ALGORITHM, key, bytes.subarray(0, IV_BYTES), {
          authTagLength: TAG_BYTES
        });
        decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
        const plaintext = Buffer.concat([
          decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)),
          decipher.final()
        ]);
        return JSON.parse(plaintext.toString('utf8')) as unknown;
      } catch {
        throw new DecryptionError();
      }
    }
  };
}
