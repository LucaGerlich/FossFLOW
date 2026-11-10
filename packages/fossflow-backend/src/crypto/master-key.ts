import { hkdfSync, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ConfigError } from '../config/config.js';

const KEY_BYTES = 32;
const HKDF_SALT = 'fossflow';

interface KeyLogger {
  warn: (message: string) => void;
}

function decode(base64: string, where: string): Buffer {
  const key = Buffer.from(base64.trim(), 'base64');
  if (key.length !== KEY_BYTES) {
    throw new ConfigError(
      `${where} must be 32 bytes, base64-encoded (generate one with: openssl rand -base64 32)`
    );
  }
  return key;
}

/**
 * The instance's master key, from FOSSFLOW_ENCRYPTION_KEY or a key file in
 * the data directory. Generates the file on first start, like n8n does.
 * Losing the key makes stored credentials unreadable, so it is never replaced.
 */
export function loadMasterKey(
  options: { dataDir: string; envKey?: string | undefined },
  logger: KeyLogger
): Buffer {
  if (options.envKey) return decode(options.envKey, 'FOSSFLOW_ENCRYPTION_KEY');

  const file = join(options.dataDir, 'config', 'encryption-key');
  try {
    return decode(readFileSync(file, 'utf8'), `The key file ${file}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const key = randomBytes(KEY_BYTES);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(file, `${key.toString('base64')}\n`, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    // Another process created it first: use theirs.
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return decode(readFileSync(file, 'utf8'), `The key file ${file}`);
    }
    throw error;
  }
  logger.warn(
    `Generated a new encryption key at ${file}. Back it up: without it, saved credentials can't be decrypted. ` +
      'Or set FOSSFLOW_ENCRYPTION_KEY to manage it yourself.'
  );
  return key;
}

/** A separate 32-byte key per purpose, so one use never weakens another. */
export function deriveKey(master: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', master, HKDF_SALT, purpose, KEY_BYTES));
}
