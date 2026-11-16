import { alertTrouble, boxForPattern } from 'src/traffic/alerts';
import { buildTrafficIndex } from 'src/traffic/match';
import type { TrafficAlert } from 'src/traffic/types';
import type { Connector, ModelItem } from 'src/types';

const items: ModelItem[] = [
  { id: 'web', name: 'Website', traffic: { ids: ['service:web'] } },
  { id: 'ml', name: 'Magicline', traffic: { ids: ['host:*.magicline.com'] } }
];
const connectors = [
  {
    id: 'arrow',
    color: 'c',
    anchors: [
      { id: 'a1', ref: { item: 'web' } },
      { id: 'a2', ref: { item: 'ml' } }
    ]
  }
] as Connector[];
const index = buildTrafficIndex(items, []);

const alert = (overrides: Partial<TrafficAlert> = {}): TrafficAlert => ({
  ruleId: 'r1',
  name: 'Rule',
  kind: 'slow',
  target: { type: 'arrow', from: 'service:web', to: 'host:*.magicline.com' },
  startedAt: '2026-01-01T10:00:00Z',
  value: 900,
  ...overrides
});

describe('boxForPattern', () => {
  it('finds the box binding a wildcard pattern verbatim', () => {
    expect(boxForPattern(index, 'host:*.magicline.com')).toBe('ml');
  });

  it('falls back to the box an identity belongs to', () => {
    expect(boxForPattern(index, 'host:api.magicline.com')).toBe('ml');
    expect(boxForPattern(index, 'service:gone')).toBeNull();
  });
});

describe('alertTrouble', () => {
  it('maps an arrow alert to the arrow between the verbatim-bound boxes', () => {
    const slow = alert();
    const { arrows, boxes } = alertTrouble([slow], index, connectors);
    expect(arrows.get('arrow')).toBe(slow);
    expect(boxes.size).toBe(0);
  });

  it('maps a box alert to its box', () => {
    const silent = alert({
      kind: 'silent',
      target: { type: 'box', identity: 'host:*.magicline.com' }
    });
    const { arrows, boxes } = alertTrouble([silent], index, connectors);
    expect(boxes.get('ml')).toBe(silent);
    expect(arrows.size).toBe(0);
  });

  it('lets failing outrank slow on the same arrow', () => {
    const slow = alert({ startedAt: '2026-01-01T09:00:00Z' });
    const failing = alert({ ruleId: 'r2', kind: 'failing' });
    expect(
      alertTrouble([slow, failing], index, connectors).arrows.get('arrow')
    ).toBe(failing);
  });

  it('prefers the oldest alert among equals', () => {
    const newer = alert({ ruleId: 'new', startedAt: '2026-01-01T11:00:00Z' });
    const older = alert({ ruleId: 'old', startedAt: '2026-01-01T08:00:00Z' });
    expect(
      alertTrouble([newer, older], index, connectors).arrows.get('arrow')
    ).toBe(older);
  });

  it('maps an alert whose boxes are not on the map to nothing', () => {
    const gone = alert({
      target: { type: 'arrow', from: 'service:x', to: 'service:y' }
    });
    const goneBox = alert({ target: { type: 'box', identity: 'db:nowhere' } });
    const { arrows, boxes } = alertTrouble([gone, goneBox], index, connectors);
    expect(arrows.size).toBe(0);
    expect(boxes.size).toBe(0);
  });
});
