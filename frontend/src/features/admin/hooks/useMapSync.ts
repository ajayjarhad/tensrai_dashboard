import { useCallback, useState } from 'react';
import { apiClient } from '@/lib/api';

export type MapSyncStatus = {
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
  percent?: number;
  lastError?: string;
};

const MAP_SYNC_TERMINAL_PHASES = new Set<MapSyncStatus['phase']>(['complete', 'skipped', 'failed']);
const MAP_SYNC_POLL_INTERVAL_MS = 2_000;

const isTerminalMapSyncStatus = (status: MapSyncStatus | null) =>
  Boolean(status && MAP_SYNC_TERMINAL_PHASES.has(status.phase));

const sleep = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

export function useMapSync() {
  const [statusByRobotId, setStatusByRobotId] = useState<Record<string, MapSyncStatus>>({});

  const runMapSync = useCallback(async (robotId: string) => {
    const record = (status: MapSyncStatus | null) => {
      if (status) setStatusByRobotId(current => ({ ...current, [robotId]: status }));
      return status;
    };

    const start = await apiClient.post<{ data?: MapSyncStatus }>(`robots/${robotId}/map-sync`);
    let status = record(start.data ?? null);

    while (!isTerminalMapSyncStatus(status)) {
      await sleep(MAP_SYNC_POLL_INTERVAL_MS);
      const poll = await apiClient.get<{ data?: MapSyncStatus }>(`robots/${robotId}/map-sync`);
      status = record(poll.data ?? null);
    }

    if (status?.phase === 'failed') {
      throw new Error(status.lastError ?? 'Map refresh failed');
    }
    return status;
  }, []);

  return { statusByRobotId, runMapSync };
}
