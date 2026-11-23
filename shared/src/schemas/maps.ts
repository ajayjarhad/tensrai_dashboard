import { z } from 'zod';
import { MAP_FEATURE_LIMITS, PATH_TYPES, TAG_TYPES, ZONE_TYPES } from '../constants/mapFeatures.js';

// What a map carries besides its image, as the dashboard stores it and robots receive it
// (metadata.json v2). Objects are loose: keys a robot adds survive a round trip.

const WorldPoint = z.tuple([z.number().finite(), z.number().finite()]);
const Id = z.union([z.string().min(1).max(64), z.number().int()]);
const Params = z.record(z.string().min(1).max(64), z.string().max(256));

export const MapZoneSchema = z.looseObject({
  id: z.string().min(1).max(64),
  type: z.enum(ZONE_TYPES),
  name: z.string().max(100).optional(),
  polygon: z.array(WorldPoint).min(3).max(MAP_FEATURE_LIMITS.vertices),
  params: Params.optional(),
});

export const MapPathSchema = z.looseObject({
  id: z.string().min(1).max(64),
  type: z.enum(PATH_TYPES),
  name: z.string().max(100).optional(),
  points: z.array(WorldPoint).min(2).max(MAP_FEATURE_LIMITS.vertices),
  // Metres: the lane a preferred path keeps cheap, or the thickness of a virtual wall.
  width: z.number().positive().max(10),
});

export const LocationTagSchema = z.looseObject({
  id: Id,
  name: z.string().max(100).optional(),
  x: z.number().finite(),
  y: z.number().finite(),
  theta: z.number().finite().optional(),
  type: z.enum(TAG_TYPES).optional(),
});

export const MissionSchema = z.looseObject({
  id: Id.optional(),
  missionId: Id.optional(),
  name: z.string().max(200).optional(),
  steps: z.array(Id).optional(),
  locationTagId: z.array(Id).optional(),
});

export const MapFeaturesSchema = z.looseObject({
  locationTags: z.array(LocationTagSchema).max(MAP_FEATURE_LIMITS.tags).optional(),
  missions: z.array(MissionSchema).max(MAP_FEATURE_LIMITS.missions).optional(),
  zones: z.array(MapZoneSchema).max(MAP_FEATURE_LIMITS.zones).optional(),
  paths: z.array(MapPathSchema).max(MAP_FEATURE_LIMITS.paths).optional(),
  // Cost (1–99) the keepout mask puts off the preferred lanes; 0 or absent leaves them free.
  preferredLaneCost: z.number().int().min(0).max(99).optional(),
});

export type MapZone = z.infer<typeof MapZoneSchema>;
export type MapPath = z.infer<typeof MapPathSchema>;
export type LocationTag = z.infer<typeof LocationTagSchema>;
export type MapFeatures = z.infer<typeof MapFeaturesSchema>;

export const MAP_YAML_MAX_BYTES = 16 * 1024;

// The map_server keys only. Yaw must be 0: Nav2's costmap ignores it while the dashboard's map
// transforms apply it, so zones would land in different places on the robot and on screen.
export const MapYamlSchema = z.strictObject({
  image: z.string().max(255).optional(),
  mode: z.enum(['trinary', 'scale', 'raw']).optional(),
  resolution: z.number().positive().max(10),
  origin: z
    .tuple([z.number().finite(), z.number().finite(), z.number().finite()])
    .refine(([, , yaw]) => yaw === 0, {
      message: 'origin yaw must be 0: Nav2 ignores it, so zones would land in the wrong place',
    }),
  negate: z.union([z.literal(0), z.literal(1), z.boolean()]).optional(),
  occupied_thresh: z.number().min(0).max(1).optional(),
  free_thresh: z.number().min(0).max(1).optional(),
});

export type MapYaml = z.infer<typeof MapYamlSchema>;
