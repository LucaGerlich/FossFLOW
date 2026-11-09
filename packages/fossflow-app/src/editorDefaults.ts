import { flattenCollections } from '@isoflow/isopacks/dist/utils';
import isoflowIsopack from '@isoflow/isopacks/dist/isoflow';
import { allLocales, HAIRLINE_ICONS } from 'fossflow';

/** Always loaded: the isoflow pack plus the hairline pack used by live data. */
export const coreIcons = [...flattenCollections([isoflowIsopack]), ...HAIRLINE_ICONS];

/** Connector colours. Ids stay stable for existing diagrams; values follow the design tokens. */
export const defaultColors = [
  { id: 'blue', value: '#0070f3' },
  { id: 'green', value: '#29bc9b' },
  { id: 'red', value: '#ee0000' },
  { id: 'orange', value: '#f5a623' },
  { id: 'purple', value: '#7928ca' },
  { id: 'black', value: '#171717' },
  { id: 'gray', value: '#a1a1a1' }
];

/** The editor's strings for an app language, falling back to English. */
export const editorLocale = (language: string) =>
  allLocales[language as keyof typeof allLocales] || allLocales['en-US'];

/** Icons people added themselves; the built-in packs are never stored with a diagram. */
export const isImportedIcon = (icon: { collection?: string }) => icon.collection === 'imported';
