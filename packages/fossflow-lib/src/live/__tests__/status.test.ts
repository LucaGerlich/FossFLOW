import { buildLiveIndex, resolveLive } from '../status';
import {
  formatBytesPerSec,
  formatMemoryMb,
  formatPercent,
  formatUptime
} from '../format';
import type { LiveSnapshot } from '../types';

const snapshot: LiveSnapshot = {
  updatedAt: 'now',
  sources: [],
  systems: [
    {
      key: 'beszel:web',
      name: 'web',
      status: 'warning',
      state: 'up',
      vitals: {
        cpu: 1,
        memory: 85,
        disk: 3,
        networkBytesPerSec: 0,
        load: null,
        uptimeSec: 1,
        temperatureC: null
      },
      history: { cpu: [], memory: [], disk: [] },
      containers: [
        {
          key: 'beszel:web/db',
          name: 'db',
          image: 'postgres:16',
          kind: 'database',
          status: 'critical',
          health: 'unhealthy',
          state: 'Up',
          cpu: 40,
          memoryMb: 2048,
          updateAvailable: false
        }
      ]
    }
  ]
};

describe('resolveLive', () => {
  const index = buildLiveIndex(snapshot);

  it('returns servers and running containers with their status', () => {
    expect(resolveLive(index, 'beszel:web')).toMatchObject({
      type: 'system',
      status: 'warning'
    });
    expect(resolveLive(index, 'beszel:web/db')).toMatchObject({
      type: 'container',
      status: 'critical',
      container: { name: 'db' }
    });
  });

  it('marks a container missing from a present server as stopped', () => {
    expect(resolveLive(index, 'beszel:web/backup')).toMatchObject({
      type: 'container',
      status: 'stopped',
      container: null,
      system: { name: 'web' }
    });
  });

  it('marks unknown servers and their containers as unknown', () => {
    expect(resolveLive(index, 'beszel:gone')).toMatchObject({
      type: 'system',
      status: 'unknown'
    });
    expect(resolveLive(index, 'beszel:gone/app')).toMatchObject({
      type: 'container',
      status: 'unknown'
    });
  });
});

describe('formatters', () => {
  it('formats percentages, memory, bandwidth and uptime', () => {
    expect(formatPercent(33.6)).toBe('34%');
    expect(formatMemoryMb(420)).toBe('420 MB');
    expect(formatMemoryMb(1228)).toBe('1.2 GB');
    expect(formatMemoryMb(2048)).toBe('2 GB');
    expect(formatBytesPerSec(512)).toBe('512 B/s');
    expect(formatBytesPerSec(4_400_000)).toBe('4.2 MB/s');
    expect(formatUptime(3_542_400)).toBe('41 d');
    expect(formatUptime(7_300)).toBe('2 h');
    expect(formatUptime(90)).toBe('1 min');
  });
});
