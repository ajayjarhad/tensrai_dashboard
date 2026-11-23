// The kinds of zones, paths and tags a map carries, and their limits. Plain values, kept apart from
// the zod schemas so the editor can use them without loading zod.

export const ZONE_TYPES = ['no_go', 'work', 'named', 'trigger', 'pick', 'drop'] as const;
export const PATH_TYPES = ['preferred', 'virtual_wall'] as const;
export const TAG_TYPES = ['mission', 'home'] as const;

export type ZoneType = (typeof ZONE_TYPES)[number];
export type PathType = (typeof PATH_TYPES)[number];
export type TagType = (typeof TAG_TYPES)[number];

export const MAP_FEATURE_LIMITS = {
  zones: 500,
  paths: 500,
  vertices: 500,
  tags: 2000,
  missions: 1000,
  bytes: 1024 * 1024,
} as const;
