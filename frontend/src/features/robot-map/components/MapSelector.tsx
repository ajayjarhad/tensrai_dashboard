import { useState } from 'react';
import type { Robot } from '@/types/robot';
import { clearActiveMapPin, setActiveMap } from '../api';

interface MapSelectorProps {
  robot: Robot | null;
  activeMapId: string | null;
  onActiveMapChange: (mapId: string) => void;
  onRefresh: () => void;
}

// Overlay shown on the live map when the selected robot has more than one map:
// pick the active map manually (pins it) or hand control back to auto-follow.
export function MapSelector({
  robot,
  activeMapId,
  onActiveMapChange,
  onRefresh,
}: MapSelectorProps) {
  const [busy, setBusy] = useState(false);
  const maps = robot?.maps ?? [];

  if (!robot || maps.length <= 1) return null;

  const activeAssignment =
    maps.find(map => map.id === activeMapId) ?? maps.find(map => map.isActive) ?? null;
  const isPinned = Boolean(activeAssignment?.isPinned);

  const handleSelect = async (mapId: string) => {
    if (!mapId || mapId === activeMapId) return;
    onActiveMapChange(mapId);
    setBusy(true);
    try {
      await setActiveMap(robot.id, mapId);
      onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const handleFollow = async () => {
    setBusy(true);
    try {
      await clearActiveMapPin(robot.id);
      onRefresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-md bg-background/90 px-2 py-1 text-sm shadow-sm backdrop-blur">
      <span className="text-xs text-muted-foreground">Map</span>
      <select
        className="rounded border bg-background px-2 py-1 text-sm"
        value={activeMapId ?? ''}
        disabled={busy}
        onChange={event => void handleSelect(event.target.value)}
      >
        {maps.map(map => (
          <option key={map.id} value={map.id}>
            {map.name ?? map.id}
          </option>
        ))}
      </select>
      {isPinned ? (
        <button
          type="button"
          className="rounded border px-2 py-1 text-xs hover:bg-accent"
          disabled={busy}
          onClick={() => void handleFollow()}
        >
          Pinned — follow robot
        </button>
      ) : (
        <span className="text-xs text-muted-foreground">Following robot</span>
      )}
    </div>
  );
}
