import type Konva from 'konva';
import type { TempLocation } from '../../hooks/useMapLocations';
import { LocationPin } from '../LocationPin';

interface LocationLayerProps {
  locations: TempLocation[];
  setPoseMode: boolean;
  onLocationSelect: (
    location: TempLocation,
    evt?: Konva.KonvaEventObject<MouseEvent | TouchEvent>
  ) => void;
}

export function LocationLayer({ locations, setPoseMode, onLocationSelect }: LocationLayerProps) {
  return (
    <>
      {locations.map(loc => {
        const handleLocationSelect = (evt?: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
          if (setPoseMode) {
            if (evt) evt.cancelBubble = true;
          }
          onLocationSelect(loc, evt);
        };

        return (
          <LocationPin
            key={loc.id}
            x={loc.x}
            y={loc.y}
            rotation={loc.rotation}
            name="location-pin"
            onClick={handleLocationSelect}
            onTap={handleLocationSelect}
          />
        );
      })}
    </>
  );
}
