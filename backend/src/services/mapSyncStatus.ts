type MapSyncStatus = {
  phase:
    | 'idle'
    | 'connecting'
    | 'manifest'
    | 'skipped'
    | 'receiving'
    | 'processing'
    | 'complete'
    | 'failed';
  robotId: string;
  mapId?: string;
  mapName?: string;
  filename?: string;
  contentHash?: string;
  bytesReceived: number;
  totalBytes?: number;
  percent?: number | undefined;
  startedAt: number;
  updatedAt: number;
  elapsedMs: number;
  lastError?: string | undefined;
};

const mapSyncStatusByRobot = new Map<string, MapSyncStatus>();
const ACTIVE_MAP_SYNC_PHASES = new Set(['connecting', 'manifest', 'receiving', 'processing']);

export const updateMapSyncStatus = (
  robotId: string,
  update: Partial<Omit<MapSyncStatus, 'robotId' | 'startedAt'>>
) => {
  const previous = mapSyncStatusByRobot.get(robotId);
  const startedAt = previous?.startedAt ?? Date.now();
  const next: MapSyncStatus = {
    phase: 'idle',
    bytesReceived: 0,
    ...previous,
    ...update,
    robotId,
    startedAt,
    updatedAt: Date.now(),
    elapsedMs: Date.now() - startedAt,
  };
  mapSyncStatusByRobot.set(robotId, next);
  return next;
};

export const getMapSyncStatus = (robotId: string): MapSyncStatus => {
  const current = mapSyncStatusByRobot.get(robotId);
  if (!current) {
    return {
      phase: 'idle',
      robotId,
      bytesReceived: 0,
      percent: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      elapsedMs: 0,
    };
  }
  return {
    ...current,
    elapsedMs: Date.now() - current.startedAt,
  };
};

export const isMapSyncActive = (status: Pick<MapSyncStatus, 'phase'> | null | undefined) =>
  Boolean(status && ACTIVE_MAP_SYNC_PHASES.has(status.phase));

// The stored status with nothing filled in; undefined until a sync has run.
export const peekMapSyncStatus = (robotId: string) => mapSyncStatusByRobot.get(robotId);

export const clearMapSyncStatus = (robotId: string) => {
  mapSyncStatusByRobot.delete(robotId);
};
