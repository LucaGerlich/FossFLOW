import type { State } from 'src/stores/reducers/types';
import { modelSchema } from 'src/schemas';
import { HAIRLINE_ICON_IDS } from '../hairlineIcons';
import { PLATE_GAP, plateFor, plateSlots, syncLiveInventory } from '../sync';
import type { LiveContainer, LiveSnapshot, LiveSystem } from '../types';

const VIEW = 'view-1';

const emptyState = (): State => ({
  model: {
    title: 'Test',
    colors: [{ id: 'c1', value: '#ffffff' }],
    icons: [],
    items: [],
    views: [
      {
        id: VIEW,
        name: 'Main',
        items: [],
        rectangles: [],
        connectors: [],
        textBoxes: []
      }
    ]
  },
  scene: { connectors: {}, textBoxes: {} }
});

const container = (
  system: string,
  name: string,
  kind: LiveContainer['kind'] = 'container'
): LiveContainer => ({
  key: `beszel:${system}/${name}`,
  name,
  image: `${name}:latest`,
  kind,
  status: 'ok',
  health: 'none',
  state: 'Up',
  cpu: 1,
  memoryMb: 10,
  updateAvailable: false
});

const system = (id: string, containers: LiveContainer[]): LiveSystem => ({
  key: `beszel:${id}`,
  name: id,
  status: 'ok',
  state: 'up',
  vitals: {
    cpu: 1,
    memory: 2,
    disk: 3,
    networkBytesPerSec: 0,
    load: null,
    uptimeSec: 1,
    temperatureC: null
  },
  history: { cpu: [], memory: [], disk: [] },
  containers
});

const snapshot = (...systems: LiveSystem[]): LiveSnapshot => ({
  updatedAt: 'now',
  systems,
  sources: []
});

const ids = () => {
  let n = 0;
  return () => `id-${(n += 1)}`;
};

const view = (state: State) => state.model.views[0]!;
const tileOf = (state: State, key: string) => {
  const item = state.model.items.find((i) => i.live?.key === key);
  return view(state).items.find((v) => v.id === item?.id)?.tile;
};

describe('plate geometry', () => {
  it('lays out slots three tiles apart, four per row', () => {
    const bounds = plateFor(0, 0, 5);
    expect(bounds).toEqual({ xMin: 0, xMax: 11, yMin: -5, yMax: 0 });
    expect(plateSlots(bounds).slice(0, 5)).toEqual([
      { x: 1, y: -1 },
      { x: 4, y: -1 },
      { x: 7, y: -1 },
      { x: 10, y: -1 },
      { x: 1, y: -4 }
    ]);
  });
});

describe('syncLiveInventory', () => {
  it('places a new server with its plate, server node and containers', () => {
    const live = snapshot(
      system('web', [
        container('web', 'app'),
        container('web', 'db', 'database')
      ])
    );
    const result = syncLiveInventory(emptyState(), VIEW, live, {
      createId: ids()
    })!;

    expect(result).not.toBeNull();
    const [plate] = view(result).rectangles!;
    expect(plate).toMatchObject({
      live: { key: 'beszel:web' },
      from: { x: 0, y: 0 },
      to: { x: 11, y: -2 }
    });
    expect(tileOf(result, 'beszel:web')).toEqual({ x: 1, y: -1 });
    expect(tileOf(result, 'beszel:web/app')).toEqual({ x: 4, y: -1 });
    expect(tileOf(result, 'beszel:web/db')).toEqual({ x: 7, y: -1 });
    const icons = result.model.items.map((i) => i.icon);
    expect(icons).toEqual(
      expect.arrayContaining([
        HAIRLINE_ICON_IDS.server,
        HAIRLINE_ICON_IDS.container,
        HAIRLINE_ICON_IDS.database
      ])
    );
    expect(result.model.icons.map((i) => i.id).sort()).toEqual(
      [
        HAIRLINE_ICON_IDS.container,
        HAIRLINE_ICON_IDS.database,
        HAIRLINE_ICON_IDS.server
      ].sort()
    );
    expect(modelSchema.safeParse(result.model).success).toBe(true);
  });

  it('does nothing when everything is already on the map', () => {
    const live = snapshot(system('web', [container('web', 'app')]));
    const first = syncLiveInventory(emptyState(), VIEW, live, {
      createId: ids()
    })!;
    expect(syncLiveInventory(first, VIEW, live)).toBeNull();
  });

  it('puts a new container in the next free slot without moving others', () => {
    const createId = ids();
    const first = syncLiveInventory(
      emptyState(),
      VIEW,
      snapshot(system('web', [container('web', 'app')])),
      { createId }
    )!;
    const second = syncLiveInventory(
      first,
      VIEW,
      snapshot(
        system('web', [container('web', 'app'), container('web', 'worker')])
      ),
      { createId }
    )!;
    expect(tileOf(second, 'beszel:web/app')).toEqual({ x: 4, y: -1 });
    expect(tileOf(second, 'beszel:web/worker')).toEqual({ x: 7, y: -1 });
  });

  it('grows a full plate by one row', () => {
    const createId = ids();
    const three = ['a', 'b', 'c'].map((n) => container('web', n));
    const first = syncLiveInventory(
      emptyState(),
      VIEW,
      snapshot(system('web', three)),
      { createId }
    )!;
    const second = syncLiveInventory(
      first,
      VIEW,
      snapshot(system('web', [...three, container('web', 'd')])),
      { createId }
    )!;
    const [plate] = view(second).rectangles!;
    expect(plate).toMatchObject({ from: { x: 0, y: 0 }, to: { x: 11, y: -5 } });
    expect(tileOf(second, 'beszel:web/d')).toEqual({ x: 1, y: -4 });
  });

  it('keeps items where a person moved them', () => {
    const createId = ids();
    const first = syncLiveInventory(
      emptyState(),
      VIEW,
      snapshot(system('web', [container('web', 'app')])),
      { createId }
    )!;
    const moved: State = {
      ...first,
      model: {
        ...first.model,
        views: [
          {
            ...view(first),
            items: view(first).items.map((v) =>
              v.tile.x === 4 ? { ...v, tile: { x: 20, y: 20 } } : v
            )
          }
        ]
      }
    };
    const second = syncLiveInventory(
      moved,
      VIEW,
      snapshot(
        system('web', [container('web', 'app'), container('web', 'new')])
      ),
      { createId }
    )!;
    expect(tileOf(second, 'beszel:web/app')).toEqual({ x: 20, y: 20 });
    expect(tileOf(second, 'beszel:web/new')).toEqual({ x: 4, y: -1 });
  });

  it('skips plate slots taken by hand-placed items', () => {
    const createId = ids();
    const first = syncLiveInventory(
      emptyState(),
      VIEW,
      snapshot(system('web', [container('web', 'app')])),
      { createId }
    )!;
    // Someone drops their own node into the next free slot (7, -1).
    const withManual: State = {
      ...first,
      model: {
        ...first.model,
        items: [...first.model.items, { id: 'manual', name: 'manual' }],
        views: [
          {
            ...view(first),
            items: [
              ...view(first).items,
              { id: 'manual', tile: { x: 7, y: -1 } }
            ]
          }
        ]
      }
    };
    const second = syncLiveInventory(
      withManual,
      VIEW,
      snapshot(
        system('web', [container('web', 'app'), container('web', 'new')])
      ),
      { createId }
    )!;
    expect(tileOf(second, 'beszel:web/new')).toEqual({ x: 10, y: -1 });
  });

  it('places a new plate to the right of hand-placed items', () => {
    const state = emptyState();
    state.model.items.push({ id: 'manual', name: 'manual' });
    view(state).items.push({ id: 'manual', tile: { x: 4, y: -1 } });
    const first = syncLiveInventory(state, VIEW, snapshot(system('web', [])), {
      createId: ids()
    })!;
    const plate = view(first).rectangles![0]!;
    // On screen, the plate's left corner (x - y) is right of the manual item.
    expect(plate.from.x - plate.from.y).toBeGreaterThan(4 - -1);
  });

  it('does not scatter containers when a person deleted the plate', () => {
    const createId = ids();
    const first = syncLiveInventory(
      emptyState(),
      VIEW,
      snapshot(system('web', [])),
      { createId }
    )!;
    const noPlate: State = {
      ...first,
      model: { ...first.model, views: [{ ...view(first), rectangles: [] }] }
    };
    expect(
      syncLiveInventory(
        noPlate,
        VIEW,
        snapshot(system('web', [container('web', 'app')])),
        { createId }
      )
    ).toBeNull();
  });

  it('places further servers to the right of existing plates', () => {
    const result = syncLiveInventory(
      emptyState(),
      VIEW,
      snapshot(system('a', []), system('b', [])),
      { createId: ids() }
    )!;
    const [second, first] = view(result).rectangles!; // createRectangle prepends
    expect(first!.from).toEqual({ x: 0, y: 0 });
    // Screen-right of the first plate (x - y grows to the right) ...
    const firstRight = first!.to.x - first!.to.y;
    expect(second!.from.x - second!.from.y).toBeGreaterThanOrEqual(
      firstRight + PLATE_GAP
    );
    // ... with the tops level, so plates form a horizontal row (x + y is height).
    expect(second!.to.x + second!.from.y).toBe(first!.to.x + first!.from.y);
  });

  it('ignores unknown views', () => {
    expect(
      syncLiveInventory(emptyState(), 'nope', snapshot(system('a', [])))
    ).toBeNull();
  });
});
