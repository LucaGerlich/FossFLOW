import { demoLandscape, startFakeBeszel } from './fakeBeszel.ts';

/**
 * Local demo source: `npm run dev:fake-beszel`, then start the backend with
 *   BESZEL_URL=http://127.0.0.1:8090 BESZEL_EMAIL=demo@example.com BESZEL_PASSWORD=demo-password
 * Vitals drift every few seconds so the map has something to show.
 */

const port = Number(process.env.FAKE_BESZEL_PORT ?? '8090');
const landscape = demoLandscape(Date.now());
const fake = await startFakeBeszel({
  port,
  email: 'demo@example.com',
  password: 'demo-password',
  ...landscape
});

const drift = (value: number): number =>
  Math.min(
    99,
    Math.max(1, Math.round((value + (Math.random() - 0.5) * 8) * 10) / 10)
  );

setInterval(() => {
  const now = Date.now();
  fake.setSystems(
    landscape.systems.map((system) => ({
      ...system,
      updated: new Date(now).toISOString(),
      info: { ...system.info, cpu: drift(Number(system.info.cpu)) }
    }))
  );
  fake.setContainers(
    landscape.containers.map((container) => ({ ...container, updated: now }))
  );
}, 5000);

process.stdout.write(
  `Fake Beszel on ${fake.url} (demo@example.com / demo-password). Ctrl+C to stop.\n`
);
