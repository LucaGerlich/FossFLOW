import { Global, Logger, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB, type Database } from '../database/database.module.js';
import { deriveKey, loadMasterKey } from '../crypto/master-key.js';
import { createMailer, MAILER, type Mailer } from '../mail/mailer.js';
import { AccountsService } from '../users/accounts.service.js';
import { AUTH, createAuth } from './auth.js';

export const MASTER_KEY = Symbol('MASTER_KEY');

@Global()
@Module({
  providers: [
    {
      provide: MASTER_KEY,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Buffer =>
        loadMasterKey(
          { dataDir: config.dataDir, envKey: config.encryptionKey },
          new Logger('Encryption')
        )
    },
    {
      provide: MAILER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Mailer => createMailer(config.smtp)
    },
    {
      provide: AUTH,
      inject: [DB, APP_CONFIG, MASTER_KEY, MAILER],
      useFactory: (db: Database, config: AppConfig, masterKey: Buffer, mailer: Mailer) =>
        createAuth({
          db,
          config,
          secret: deriveKey(masterKey, 'better-auth').toString('base64'),
          mailer
        })
    },
    AccountsService
  ],
  exports: [AUTH, MAILER, MASTER_KEY, AccountsService]
})
export class AuthModule {}
