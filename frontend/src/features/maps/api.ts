import type { MapFeatures, MapYaml } from '@tensrai/shared';
import { HTTPError } from 'ky';
import { api, apiClient } from '@/lib/api';
import { syncRobotMaps } from './robotSync';

export type MapRobotState =
  | 'synced'
  | 'needs_sync'
  | 'syncing'
  | 'failed'
  | 'conflict'
  | 'unsupported';

export interface MapRobot {
  robotId: string;
  name: string;
  isActive: boolean;
  filename: string | null;
  syncedAt: string | null;
  state: MapRobotState;
  error?: string;
  phase?: 'importing' | 'sending' | 'removing';
  // On its way to the robot, or refused by it: the robot doesn't hold the map yet.
  assigning?: boolean;
}

export interface MapSummary {
  id: string;
  name: string;
  filename: string;
  editedAt: string | null;
  editedBy?: string | null;
  revision: string | null;
  contentHash: string | null;
  pixelWidth: number | null;
  pixelHeight: number | null;
  metadata: { resolution?: number; origin?: number[] } | null;
  robots: MapRobot[];
}

export interface MapDetail extends Omit<MapSummary, 'metadata'> {
  metadata: MapYaml;
  features: MapFeatures;
  yamlText: string;
}

// What assigning a map would do on one robot (GET /maps/:id/assignment-preview).
export interface AssignmentPreview {
  robotId: string;
  holds: boolean;
  stem: string;
  stemTaken?: string;
  missionClashes: number[];
  clashMapName?: string;
  hasMappingBridge: boolean;
  cannotReceiveMaps: boolean;
}

export interface MapCopy {
  imageSha256: string | null;
  yaml: Record<string, unknown> | null;
  features: MapFeatures | null;
}

// Both sides of a conflict (GET /maps/:id/robots/:robotId/conflict).
export interface ConflictDetail {
  ours: MapCopy & { editedAt: string | null; editedBy: string | null };
  robot: MapCopy & { at: string | null };
}

export interface PushResult {
  robotId: string;
  started: boolean;
  code?: string;
  error?: string;
}

// ky retries PUT, PATCH and DELETE on a 5xx by default; a map change must run once.
const once = { retry: 0 } as const;

export const mapsApi = {
  list: async () => (await apiClient.get<{ data: MapSummary[] }>('maps')).data,
  upload: (body: { name: string; yaml: string; pgmGzipBase64: string; features?: unknown }) =>
    apiClient.post<{ data: { id: string; revision: string | null } }>('maps', body, {
      ...once,
      timeout: 60_000,
    }),
  detail: async (id: string) => (await apiClient.get<{ data: MapDetail }>(`maps/${id}`)).data,
  assignmentPreview: async (id: string) =>
    (await apiClient.get<{ data: AssignmentPreview[] }>(`maps/${id}/assignment-preview`)).data,
  conflict: async (id: string, robotId: string) =>
    (await apiClient.get<{ data: ConflictDetail }>(`maps/${id}/robots/${robotId}/conflict`)).data,
  // The image URL is cached as immutable, so it carries the revision it belongs to.
  image: (id: string, revision: string) =>
    api
      .get(`maps/${id}/image?rev=${encodeURIComponent(revision)}`, { timeout: 60_000 })
      .arrayBuffer(),
  update: (id: string, body: Record<string, unknown>) =>
    apiClient.patch<{ data: { id: string; revision: string | null } }>(`maps/${id}`, body, {
      ...once,
      timeout: 60_000,
    }),
  remove: (id: string) => apiClient.delete(`maps/${id}`, once),
  assign: (id: string, robotId: string) =>
    apiClient.put(`maps/${id}/robots/${robotId}`, undefined, once),
  unassign: (id: string, robotId: string) => apiClient.delete(`maps/${id}/robots/${robotId}`, once),
  push: async (id: string, robotIds?: string[]) =>
    (
      await apiClient.post<{ data: PushResult[] }>(
        `maps/${id}/push`,
        robotIds ? { robotIds } : {},
        once
      )
    ).data,
  pushRobot: syncRobotMaps,
  resolve: (id: string, robotId: string, keep: 'dashboard' | 'robot') =>
    apiClient.post(`maps/${id}/robots/${robotId}/resolve`, { keep }, once),
};

// The API's error code (MAP_DUPLICATE, MISSION_ID_CONFLICT, ...), when there is one.
export const errorCodeOf = async (error: unknown) => {
  if (!(error instanceof HTTPError)) return undefined;
  const body = (await error.response
    .clone()
    .json()
    .catch(() => null)) as { code?: string } | null;
  return body?.code;
};

export const errorMessageOf = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

// Images travel gzipped and base64-encoded inside the JSON body.
export const gzipBase64 = async (blob: Blob) => {
  const gzipped = await new Response(
    blob.stream().pipeThrough(new CompressionStream('gzip'))
  ).blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(gzipped);
  });
};
