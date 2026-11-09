import { iconSchema } from 'src/schemas';
import {
  HAIRLINE_COLLECTION,
  HAIRLINE_ICON_IDS,
  HAIRLINE_ICONS,
  getHairlineStatusOffset
} from '../hairlineIcons';

describe('hairline icon pack', () => {
  it('provides one valid isometric icon per kind with unique ids', () => {
    expect(HAIRLINE_ICONS).toHaveLength(Object.keys(HAIRLINE_ICON_IDS).length);
    expect(new Set(HAIRLINE_ICONS.map((icon) => icon.id)).size).toBe(
      HAIRLINE_ICONS.length
    );
    for (const icon of HAIRLINE_ICONS) {
      expect(iconSchema.safeParse(icon).success).toBe(true);
      expect(icon.isIsometric).toBe(true);
      expect(icon.collection).toBe(HAIRLINE_COLLECTION);
    }
  });

  it('encodes self-contained SVGs on one shared canvas', () => {
    for (const icon of HAIRLINE_ICONS) {
      expect(icon.url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(
        true
      );
      const svg = decodeURIComponent(icon.url.split(',').slice(1).join(','));
      expect(svg).toContain('viewBox="0 0 104 132"');
      expect(svg).not.toMatch(/NaN|undefined|<script|href=/);
    }
  });

  it('knows where the status light sits on blocks that have one', () => {
    for (const kind of [
      'server',
      'container',
      'database',
      'cache',
      'queue',
      'gateway'
    ] as const) {
      const offset = getHairlineStatusOffset(HAIRLINE_ICON_IDS[kind]);
      expect(offset).not.toBeNull();
      // Lights sit on the lid: above the tile centre.
      expect(offset!.y).toBeLessThan(0);
    }
    expect(getHairlineStatusOffset(HAIRLINE_ICON_IDS.globe)).toBeNull();
    expect(getHairlineStatusOffset('some-other-icon')).toBeNull();
    expect(getHairlineStatusOffset(undefined)).toBeNull();
  });
});
