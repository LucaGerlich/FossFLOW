import { PROJECTED_TILE_SIZE, TILE_PROJECTION_MULTIPLIERS } from 'src/config';
import type { Coords, Icon } from 'src/types';

/**
 * Hairline icon pack: ink-outlined isometric blocks in the style of the
 * project's design file. Usable by hand like any icon, and used by live
 * discovery for servers and containers.
 *
 * Every icon shares one canvas whose centre is the block's footprint centre,
 * so the block sits exactly on its tile (isometric icons are centred on the
 * tile) and the position of each block's status light is known.
 */

export const HAIRLINE_COLLECTION = 'hairline';

export const HAIRLINE_ICON_IDS = {
  server: 'hairline-server',
  container: 'hairline-container',
  database: 'hairline-database',
  cache: 'hairline-cache',
  queue: 'hairline-queue',
  gateway: 'hairline-gateway',
  globe: 'hairline-globe',
  cloud: 'hairline-cloud'
} as const;

export type HairlineKind = keyof typeof HAIRLINE_ICON_IDS;

type Pt = [number, number];

/** Floor projection ratio of the renderer (true isometric, ~tan 30°). */
const ISO =
  TILE_PROJECTION_MULTIPLIERS.height / TILE_PROJECTION_MULTIPLIERS.width;
const VIEW_WIDTH = 104;
const CX = VIEW_WIDTH / 2;
const CY = 66;
const VIEW_HEIGHT = CY * 2;
/** Rendered pixels per canvas unit at icon scale 1 (see IsometricIcon). */
const PX_PER_UNIT = (PROJECTED_TILE_SIZE.width * 0.8) / VIEW_WIDTH;

const INK = '#171717';
const DETAIL = '#a1a1a1';
const TOP = '#ffffff';
const LEFT = '#f5f5f5';
const RIGHT = '#e8e8e8';
const SOCKET = '#d4d4d4';
const SHADOW = 'rgba(0,0,0,0.06)';
const STROKE = 1.4;

const r2 = (n: number): number => Math.round(n * 100) / 100;
const pts = (points: Pt[]): string =>
  points.map(([x, y]) => `${r2(x)},${r2(y)}`).join(' ');
const lerp = (a: Pt, b: Pt, t: number): Pt => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t
];

const polygon = (points: Pt[], fill: string): string =>
  `<polygon points="${pts(points)}" fill="${fill}" stroke="${INK}" stroke-width="${STROKE}" stroke-linejoin="round"/>`;

const line = (a: Pt, b: Pt, colour = DETAIL, width = 1): string =>
  `<line x1="${r2(a[0])}" y1="${r2(a[1])}" x2="${r2(b[0])}" y2="${r2(b[1])}" stroke="${colour}" stroke-width="${width}" stroke-linecap="round"/>`;

const socket = ([x, y]: Pt): string =>
  `<ellipse cx="${r2(x)}" cy="${r2(y)}" rx="2.4" ry="${r2(2.4 * ISO + 0.3)}" fill="none" stroke="${SOCKET}" stroke-width="1"/>`;

const floorShadow = (rx: number): string =>
  `<ellipse cx="${CX}" cy="${CY}" rx="${rx}" ry="${r2(rx * ISO)}" fill="${SHADOW}"/>`;

interface Drawing {
  svg: string;
  /** Where the live status light goes, in canvas units; null for no light. */
  status: Pt | null;
}

interface PrismDetails {
  vents?: boolean;
  leds?: boolean;
  bays?: boolean;
  ports?: boolean;
}

/** A box standing on the floor at (cx, cy) with half-width `a` and height `h`. */
function prism(
  cy: number,
  a: number,
  h: number,
  details: PrismDetails = {}
): Drawing {
  const b = a * ISO;
  const top: Pt[] = [
    [CX, cy - h - b],
    [CX + a, cy - h],
    [CX, cy - h + b],
    [CX - a, cy - h]
  ];
  const left: Pt[] = [
    [CX - a, cy - h],
    [CX, cy - h + b],
    [CX, cy + b],
    [CX - a, cy]
  ];
  const right: Pt[] = [
    [CX, cy - h + b],
    [CX + a, cy - h],
    [CX + a, cy],
    [CX, cy + b]
  ];
  const onRight = (u: number, w: number): Pt => [
    CX + u * a,
    cy - h + b - u * b + w * h
  ];
  const onLeft = (u: number, w: number): Pt => [
    CX - a + u * a,
    cy - h + u * b + w * h
  ];
  const lidCentre: Pt = [CX, cy - h];

  const parts = [polygon(left, LEFT), polygon(right, RIGHT), polygon(top, TOP)];
  for (const corner of top) {
    const [x, y] = lerp(corner, lidCentre, 0.2);
    parts.push(`<circle cx="${r2(x)}" cy="${r2(y)}" r="0.9" fill="${INK}"/>`);
  }
  if (details.vents) {
    for (let k = 0; k < 5; k += 1) {
      const u = 0.12 + k * 0.06;
      parts.push(line(onRight(u, 0.38), onRight(u, 0.74)));
    }
  }
  if (details.leds) {
    for (const u of [0.64, 0.76, 0.88]) {
      const [x, y] = onRight(u, 0.56);
      parts.push(
        `<ellipse cx="${r2(x)}" cy="${r2(y)}" rx="1.5" ry="1.2" fill="${SOCKET}"/>`
      );
    }
  }
  if (details.bays) {
    for (const w of [0.4, 0.7])
      parts.push(line(onLeft(0.12, w), onLeft(0.62, w)));
  }
  if (details.ports) {
    for (const u of [0.18, 0.34, 0.5, 0.66]) {
      parts.push(line(onLeft(u, 0.58), onLeft(u + 0.09, 0.58), DETAIL, 2.4));
    }
  }
  const status = lerp(top[1] as Pt, lidCentre, 0.42);
  parts.push(socket(status));
  return { svg: parts.join(''), status };
}

/** An upright cylinder (database, cache) with optional bands. */
function cylinder(r: number, h: number, bands: number): Drawing {
  const ry = r * ISO;
  const x0 = r2(CX - r);
  const x1 = r2(CX + r);
  const outline = `M${x0},${CY - h} L${x0},${CY} A${r},${r2(ry)} 0 0 0 ${x1},${CY} L${x1},${CY - h}`;
  const parts = [
    `<path d="${outline} Z" fill="${RIGHT}"/>`,
    `<path d="M${x0},${CY - h} L${x0},${CY} A${r},${r2(ry)} 0 0 0 ${CX},${r2(CY + ry)} L${CX},${r2(CY - h + ry)} A${r},${r2(ry)} 0 0 1 ${x0},${CY - h} Z" fill="${LEFT}"/>`
  ];
  for (let k = 1; k <= bands; k += 1) {
    const y = r2(CY - h + (h * k) / (bands + 1));
    parts.push(
      `<path d="M${x0},${y} A${r},${r2(ry)} 0 0 0 ${x1},${y}" fill="none" stroke="${INK}" stroke-width="${STROKE}"/>`
    );
  }
  parts.push(
    `<path d="${outline}" fill="none" stroke="${INK}" stroke-width="${STROKE}" stroke-linejoin="round"/>`
  );
  parts.push(
    `<ellipse cx="${CX}" cy="${CY - h}" rx="${r}" ry="${r2(ry)}" fill="${TOP}" stroke="${INK}" stroke-width="${STROKE}"/>`
  );
  const status: Pt = [CX + r * 0.52, CY - h];
  parts.push(socket(status));
  return { svg: parts.join(''), status };
}

function stack(): Drawing {
  const slabs = [0, 1, 2].map((k) =>
    prism(CY - k * 10.5, 34, 7, { leds: k === 2 })
  );
  return {
    svg: slabs.map((s) => s.svg).join(''),
    status: slabs[2]?.status ?? null
  };
}

function globe(): Drawing {
  const gy = CY - 36;
  const r = 22;
  return {
    svg: [
      floorShadow(20),
      line([CX, gy + r], [CX, CY], DETAIL, 1),
      `<circle cx="${CX}" cy="${gy}" r="${r}" fill="${TOP}" stroke="${INK}" stroke-width="${STROKE}"/>`,
      `<ellipse cx="${CX}" cy="${gy}" rx="9" ry="${r}" fill="none" stroke="${INK}" stroke-width="1.1"/>`,
      line([CX - r, gy], [CX + r, gy], INK, 1.1),
      `<path d="M${CX - 19},${gy - 11} Q${CX},${gy - 6} ${CX + 19},${gy - 11} M${CX - 19},${gy + 11} Q${CX},${gy + 16} ${CX + 19},${gy + 11}" fill="none" stroke="${INK}" stroke-width="1"/>`
    ].join(''),
    status: null
  };
}

function cloud(): Drawing {
  const y0 = CY - 26;
  const shape = (dx: number, dy: number, fill: string): string =>
    `<path d="M${CX - 28 + dx},${y0 + dy} a9,9 0 0 1 3,-16 a14,14 0 0 1 25,-7 a11,11 0 0 1 20,5 a9,9 0 0 1 8,18 Z" fill="${fill}" stroke="${INK}" stroke-width="${STROKE}" stroke-linejoin="round"/>`;
  return {
    svg: [floorShadow(24), shape(3, 2.5, RIGHT), shape(0, 0, TOP)].join(''),
    status: null
  };
}

const DRAWINGS: Record<HairlineKind, { name: string; drawing: Drawing }> = {
  server: {
    name: 'Server',
    drawing: prism(CY, 50, 22, { vents: true, leds: true, bays: true })
  },
  container: {
    name: 'Container',
    drawing: prism(CY, 32, 32, { vents: true, leds: true })
  },
  database: { name: 'Database', drawing: cylinder(32, 40, 2) },
  cache: { name: 'Cache', drawing: cylinder(24, 26, 1) },
  queue: { name: 'Queue', drawing: stack() },
  gateway: {
    name: 'Gateway',
    drawing: prism(CY, 46, 13, { leds: true, ports: true })
  },
  globe: { name: 'Clients', drawing: globe() },
  cloud: { name: 'Cloud service', drawing: cloud() }
};

const toDataUrl = (body: string): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}">${body}</svg>`
  )}`;

export const HAIRLINE_ICONS: Icon[] = (
  Object.keys(DRAWINGS) as HairlineKind[]
).map((kind) => ({
  id: HAIRLINE_ICON_IDS[kind],
  name: DRAWINGS[kind].name,
  collection: HAIRLINE_COLLECTION,
  isIsometric: true,
  url: toDataUrl(DRAWINGS[kind].drawing.svg)
}));

const STATUS_OFFSETS = new Map<string, Coords>(
  (Object.keys(DRAWINGS) as HairlineKind[]).flatMap((kind) => {
    const status = DRAWINGS[kind].drawing.status;
    if (!status) return [];
    return [
      [
        HAIRLINE_ICON_IDS[kind],
        { x: (status[0] - CX) * PX_PER_UNIT, y: (status[1] - CY) * PX_PER_UNIT }
      ] as [string, Coords]
    ];
  })
);

/**
 * Pixel offset from the tile centre to a hairline icon's status light at
 * icon scale 1, or null for icons without one.
 */
export function getHairlineStatusOffset(
  iconId: string | undefined
): Coords | null {
  return iconId ? (STATUS_OFFSETS.get(iconId) ?? null) : null;
}
