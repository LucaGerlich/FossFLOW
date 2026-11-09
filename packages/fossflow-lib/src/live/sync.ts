import type { Coords, Icon, Rectangle, View } from 'src/types';
import type { State } from 'src/stores/reducers/types';
import { createModelItem } from 'src/stores/reducers/modelItem';
import { createViewItem } from 'src/stores/reducers/viewItem';
import {
  createRectangle,
  updateRectangle
} from 'src/stores/reducers/rectangle';
import { generateId } from 'src/utils/common';
import { VIEW_ITEM_DEFAULTS } from 'src/config';
import { HAIRLINE_ICONS, HAIRLINE_ICON_IDS } from './hairlineIcons';
import type {
  LiveContainer,
  LiveContainerKind,
  LiveSnapshot,
  LiveSystem
} from './types';

/**
 * Places newly discovered servers and containers on a view.
 *
 * Rules: a new server gets a plate (rectangle) to the right of existing
 * content, a server node in its first slot and its containers in a grid of
 * slots two tiles apart. A new container on a known server takes the next free
 * slot on that server's plate, growing the plate by one row when it is full.
 * Nothing a person placed is ever moved or deleted.
 */

export const PLATE_COLUMNS = 4;
/** Tiles between slots: room for each node's label and metric chip. */
export const SLOT_SPACING = 3;
/** Tiles between a plate's edge and its outer slots. */
const PLATE_MARGIN = 1;
/** Plate width in tiles along x. */
const PLATE_WIDTH = (PLATE_COLUMNS - 1) * SLOT_SPACING + 2 * PLATE_MARGIN;
/** Horizontal gap between plates in half-tile units: room for a vitals card. */
export const PLATE_GAP = 5;
const PLATE_COLOR = '#f2f2f2';
const MAX_NAME = 100;
/** Cap on remembered container keys per plate. */
const MAX_KNOWN = 2000;

const KIND_ICON: Record<LiveContainerKind, string> = {
  container: HAIRLINE_ICON_IDS.container,
  database: HAIRLINE_ICON_IDS.database,
  cache: HAIRLINE_ICON_IDS.cache,
  queue: HAIRLINE_ICON_IDS.queue,
  gateway: HAIRLINE_ICON_IDS.gateway
};

const tileKey = ({ x, y }: Coords): string => `${x},${y}`;

interface Bounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

const boundsOf = ({ from, to }: Pick<Rectangle, 'from' | 'to'>): Bounds => ({
  xMin: Math.min(from.x, to.x),
  xMax: Math.max(from.x, to.x),
  yMin: Math.min(from.y, to.y),
  yMax: Math.max(from.y, to.y)
});

/** Slots inside a plate, in reading order (rows toward the viewer, columns to the right). */
export function plateSlots(bounds: Bounds): Coords[] {
  const slots: Coords[] = [];
  for (
    let y = bounds.yMax - PLATE_MARGIN;
    y >= bounds.yMin + PLATE_MARGIN;
    y -= SLOT_SPACING
  ) {
    for (
      let x = bounds.xMin + PLATE_MARGIN;
      x <= bounds.xMax - PLATE_MARGIN;
      x += SLOT_SPACING
    ) {
      slots.push({ x, y });
    }
  }
  return slots;
}

/** Plate bounds for `slotCount` slots with its back-left corner at (x0, y0). */
export function plateFor(x0: number, y0: number, slotCount: number): Bounds {
  const rows = Math.max(1, Math.ceil(slotCount / PLATE_COLUMNS));
  const span = (count: number): number =>
    (count - 1) * SLOT_SPACING + 2 * PLATE_MARGIN;
  return {
    xMin: x0,
    xMax: x0 + PLATE_WIDTH,
    yMin: y0 - span(rows),
    yMax: y0
  };
}

/**
 * Where the next new plate goes: on screen, to the right of everything already
 * on the view, with its top level with the content's top, so plates form a
 * horizontal row. On screen, `x - y` grows to the right and `x + y` upwards.
 */
export function nextPlateOrigin(view: View): Coords {
  const points: Coords[] = [
    ...view.items.map((item) => item.tile),
    ...(view.textBoxes ?? []).map((box) => box.tile),
    ...(view.rectangles ?? []).flatMap(({ from, to }) => [
      from,
      to,
      { x: from.x, y: to.y },
      { x: to.x, y: from.y }
    ])
  ];
  // ponytail: one endless row; wrap into several rows once landscapes get big.
  if (points.length === 0) return { x: 0, y: 0 };
  let right = Math.max(...points.map(({ x, y }) => x - y)) + PLATE_GAP;
  const top = Math.max(...points.map(({ x, y }) => x + y)) - PLATE_WIDTH;
  if ((right + top) % 2 !== 0) right += 1; // tiles are integers
  return { x: (top + right) / 2, y: (top - right) / 2 };
}

const truncate = (name: string): string =>
  name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name;

export interface SyncOptions {
  createId?: () => string;
}

/**
 * Returns the state with newly discovered items placed on `viewId`, or `null`
 * when there is nothing to add.
 */
export function syncLiveInventory(
  state: State,
  viewId: string,
  snapshot: LiveSnapshot,
  { createId = generateId }: SyncOptions = {}
): State | null {
  const viewIndex = state.model.views.findIndex((v) => v.id === viewId);
  if (viewIndex === -1) return null;

  const boundItems = new Set(
    state.model.items.flatMap((item) => (item?.live ? [item.live.key] : []))
  );
  let next = state;
  let changed = false;

  const view = (): View => next.model.views[viewIndex] as View;
  const occupied = (): Set<string> =>
    new Set(view().items.map((item) => tileKey(item.tile)));

  const ensureIcon = (iconId: string): void => {
    if (next.model.icons.some((icon) => icon.id === iconId)) return;
    const icon = HAIRLINE_ICONS.find(
      (candidate) => candidate.id === iconId
    ) as Icon;
    next = {
      ...next,
      model: { ...next.model, icons: [...next.model.icons, icon] }
    };
  };

  const placeNode = (
    key: string,
    name: string,
    icon: string,
    tile: Coords
  ): void => {
    ensureIcon(icon);
    const id = createId();
    next = createModelItem(
      { id, name: truncate(name), icon, live: { key } },
      next
    );
    next = createViewItem(
      { id, tile, labelHeight: VIEW_ITEM_DEFAULTS.labelHeight },
      { viewId, state: next }
    );
    boundItems.add(key);
    changed = true;
  };

  const plateFind = (key: string): Rectangle | undefined =>
    (view().rectangles ?? []).find((rect) => rect.live?.key === key);

  const freeSlot = (plate: Rectangle): Coords | null => {
    const taken = occupied();
    return (
      plateSlots(boundsOf(plate)).find((slot) => !taken.has(tileKey(slot))) ??
      null
    );
  };

  const growPlate = (plate: Rectangle): Rectangle => {
    const bounds = boundsOf(plate);
    const grown = {
      from: { x: bounds.xMin, y: bounds.yMax },
      to: { x: bounds.xMax, y: bounds.yMin - SLOT_SPACING }
    };
    next = updateRectangle({ id: plate.id, ...grown }, { viewId, state: next });
    return { ...plate, ...grown };
  };

  /** Records that a plate has placed `key`, so a later deletion sticks. */
  const remember = (plateId: string, key: string): void => {
    const plate = (view().rectangles ?? []).find((rect) => rect.id === plateId);
    if (!plate?.live) return;
    const known = [...(plate.live.known ?? []), key].slice(-MAX_KNOWN);
    next = updateRectangle(
      { id: plateId, live: { ...plate.live, known } },
      { viewId, state: next }
    );
  };

  const addContainerToPlate = (
    container: LiveContainer,
    plate: Rectangle
  ): void => {
    let target = plate;
    let slot = freeSlot(target);
    if (!slot) {
      target = growPlate(target);
      slot = freeSlot(target);
    }
    if (!slot) return;
    placeNode(container.key, container.name, KIND_ICON[container.kind], slot);
    remember(plate.id, container.key);
  };

  /**
   * New server, or a plate a person deleted: put everything of this server
   * that is not on the map yet on a fresh plate (deleting a plate is how to
   * bring hidden containers back).
   */
  const addSystem = (system: LiveSystem): void => {
    const placeServer = !boundItems.has(system.key);
    const containers = system.containers.filter(
      (container) => !boundItems.has(container.key)
    );
    if (!placeServer && containers.length === 0) return;

    const origin = nextPlateOrigin(view());
    const bounds = plateFor(
      origin.x,
      origin.y,
      containers.length + (placeServer ? 1 : 0)
    );
    const plate: Rectangle = {
      id: createId(),
      customColor: PLATE_COLOR,
      from: { x: bounds.xMin, y: bounds.yMax },
      to: { x: bounds.xMax, y: bounds.yMin },
      live: {
        key: system.key,
        known: system.containers.map((c) => c.key).slice(-MAX_KNOWN)
      }
    };
    next = createRectangle(plate, { viewId, state: next });
    changed = true;
    const slots = plateSlots(bounds);
    if (placeServer) {
      const serverSlot = slots.shift();
      if (serverSlot) {
        placeNode(
          system.key,
          system.name,
          HAIRLINE_ICON_IDS.server,
          serverSlot
        );
      }
    }
    containers.forEach((container, index) => {
      const slot = slots[index];
      if (slot) {
        placeNode(
          container.key,
          container.name,
          KIND_ICON[container.kind],
          slot
        );
      }
    });
  };

  for (const system of snapshot.systems) {
    const plate = plateFind(system.key);
    if (!plate) {
      addSystem(system);
      continue;
    }
    // Containers this plate placed before and that are gone from the map
    // were deleted on purpose: never bring them back.
    const known = new Set(plate.live?.known ?? []);
    for (const container of system.containers) {
      if (!boundItems.has(container.key) && !known.has(container.key)) {
        addContainerToPlate(container, plateFind(system.key) ?? plate);
      }
    }
  }

  return changed ? next : null;
}
