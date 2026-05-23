import type { TempLocation } from '../../hooks/useMapLocations';
import { LocationPin } from '../LocationPin';

interface LocationLayerProps {
  locations: TempLocation[];
  setPoseMode: boolean;
  highlightTagIds?: Set<string>;
  dimNonMissionTags?: boolean;
  onLocationSelect: (location: TempLocation) => void;
}

export function LocationLayer({
  locations,
  setPoseMode,
  highlightTagIds,
  dimNonMissionTags = false,
  onLocationSelect,
}: LocationLayerProps) {
  return (
    <>
      {locations.map(loc => {
        const isHighlighted = highlightTagIds ? highlightTagIds.has(loc.id) : true;
        const isDimmed = dimNonMissionTags && !isHighlighted;
        const isInteractive = !isDimmed && !setPoseMode;

        const handleClick = () => {
          if (!isInteractive) return;
          onLocationSelect(loc);
        };

        return (
          <LocationPin
            key={loc.id}
            x={loc.x}
            y={loc.y}
            rotation={loc.rotation}
            name="location-pin"
            color={isDimmed ? '#6b7280' : '#01FF01'}
            opacity={isDimmed ? 0.35 : 1}
            listening={isInteractive}
            {...(setPoseMode ? { hitRadius: 0 } : {})}
            onClick={handleClick}
            onTap={handleClick}
          />
        );
      })}
    </>
  );
}
