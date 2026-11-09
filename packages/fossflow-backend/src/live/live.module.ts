import {
  Inject,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { createBeszelClient } from './beszel.js';
import { createLiveHub, type LiveHub } from './hub.js';
import { LIVE_HUB, LiveController } from './live.controller.js';

const logger = new Logger('Live');
const liveLogger = {
  info: (message: string) => logger.log(message),
  warn: (message: string) => logger.warn(message)
};

@Module({
  controllers: [LiveController],
  providers: [
    {
      provide: LIVE_HUB,
      inject: [APP_CONFIG],
      useFactory: ({ live }: AppConfig): LiveHub | null => {
        if (!live.ok) {
          logger.log(live.reason ? `Disabled: ${live.reason}` : 'Disabled');
          return null;
        }
        const { config } = live;
        logger.log(
          `Beszel at ${new URL(config.beszel.url).host}, every ${config.pollSeconds}s`
        );
        return createLiveHub({
          config,
          client: createBeszelClient(config.beszel),
          logger: liveLogger
        });
      }
    }
  ]
})
export class LiveModule
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  constructor(@Inject(LIVE_HUB) private readonly hub: LiveHub | null) {}

  onApplicationBootstrap(): void {
    this.hub?.start();
  }

  onApplicationShutdown(): void {
    this.hub?.stop();
  }
}
