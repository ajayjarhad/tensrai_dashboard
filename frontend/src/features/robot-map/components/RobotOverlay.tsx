/**
 * Robot Overlay Component
 * Renders robot positions, trajectories, and status indicators on maps
 */

import type { ROSPoseStamped, WorldPoint } from '@tensrai/shared';
import * as React from 'react';
import { useCallback, useMemo } from 'react';
import { Arrow, Circle, Line, Text } from 'react-konva';
import { useMultiMapStore } from '../stores/useMultiMapStore';

interface RobotOverlayProps {
  mapId: string;
  showLabels?: boolean;
  showTrajectories?: boolean;
  trajectoryLength?: number;
  showOrientation?: boolean;
  showStatusIndicators?: boolean;
  robotSize?: number;
  selectedRobotIds?: string[];
  onRobotClick?: (robotId: string) => void;
}

interface RobotPosition {
  robotId: string;
  position: WorldPoint;
  orientation: number;
  timestamp: Date;
  status: 'online' | 'offline' | 'error';
  name: string;
  trajectory: WorldPoint[];
}

const STATUS_COLORS = {
  online: '#00ff00',
  offline: '#ff9900',
  error: '#ff0000',
  unknown: '#cccccc',
} as const;

export function RobotOverlay({
  mapId,
  showLabels = true,
  showTrajectories = false,
  trajectoryLength = 50,
  showOrientation = true,
  showStatusIndicators = true,
  robotSize = 8,
  selectedRobotIds = [],
  onRobotClick,
}: RobotOverlayProps) {
  const { robots, layers } = useMultiMapStore();

  const generateTrajectory = useCallback((currentPos: WorldPoint, length: number): WorldPoint[] => {
    const trajectory: WorldPoint[] = [];
    for (let i = length - 1; i >= 0; i--) {
      const factor = i / length;
      trajectory.push({
        x: currentPos.x - Math.sin(Date.now() / 1000 + i) * 0.5 * factor,
        y: currentPos.y - Math.cos(Date.now() / 1000 + i) * 0.5 * factor,
      });
    }
    return trajectory;
  }, []);

  const robotPositions = useMemo(() => {
    const mapLayerId = `map-${mapId}`;
    const mapLayer = layers.get(mapLayerId);

    if (!mapLayer) return [];

    return Array.from(robots.values())
      .filter(robot => {
        const _assignment = Array.from(layers.values()).find(
          layer =>
            layer.mapId === mapId && layer.type === 'robot' && (layer as any).robotId === robot.id
        );
        return _assignment && robot.currentPose;
      })
      .map(robot => {
        const pose = robot.currentPose as ROSPoseStamped;
        const position = { x: pose.pose.position.x, y: pose.pose.position.y };

        const orientation = Math.atan2(
          2 *
            (pose.pose.orientation.w * pose.pose.orientation.z +
              pose.pose.orientation.x * pose.pose.orientation.y),
          1 -
            2 *
              (pose.pose.orientation.y * pose.pose.orientation.y +
                pose.pose.orientation.z * pose.pose.orientation.z)
        );

        const trajectory = generateTrajectory(position, trajectoryLength);

        return {
          robotId: robot.id,
          position,
          orientation,
          timestamp: robot.lastUpdate,
          status: robot.status,
          name: robot.name || robot.id,
          trajectory,
        } as RobotPosition;
      });
  }, [robots, layers, mapId, trajectoryLength, generateTrajectory]);

  const handleRobotClick = useCallback(
    (robotId: string) => {
      onRobotClick?.(robotId);
    },
    [onRobotClick]
  );

  const renderRobot = useCallback(
    (robot: RobotPosition) => {
      const isSelected = selectedRobotIds.includes(robot.robotId);
      const statusColor = STATUS_COLORS[robot.status] || STATUS_COLORS.unknown;

      return (
        <React.Fragment key={robot.robotId}>
          {showTrajectories && robot.trajectory.length > 1 && (
            <Line
              points={robot.trajectory.flatMap(p => [p.x, p.y])}
              stroke={statusColor}
              strokeWidth={2}
              opacity={0.3}
              dash={[5, 5]}
            />
          )}

          {showStatusIndicators && (
            <Circle
              x={robot.position.x}
              y={robot.position.y}
              radius={robotSize + 4}
              fill="white"
              stroke={statusColor}
              strokeWidth={3}
            />
          )}

          <Circle
            x={robot.position.x}
            y={robot.position.y}
            radius={robotSize}
            fill={statusColor}
            stroke={isSelected ? '#ffffff' : 'black'}
            strokeWidth={isSelected ? 3 : 1}
            shadowColor="rgba(0, 0, 0, 0.3)"
            shadowBlur={5}
            shadowOffset={{ x: 2, y: 2 }}
            shadowOpacity={0.5}
            onClick={() => handleRobotClick(robot.robotId)}
          />

          {showOrientation && (
            <Arrow
              x={robot.position.x}
              y={robot.position.y}
              points={[
                0,
                0,
                Math.cos(robot.orientation) * robotSize * 1.5,
                Math.sin(robot.orientation) * robotSize * 1.5,
              ]}
              stroke="black"
              strokeWidth={2}
              fill="black"
            />
          )}

          {showLabels && (
            <Text
              x={robot.position.x}
              y={robot.position.y - robotSize - 10}
              text={robot.name}
              fontSize={12}
              fill="black"
              padding={4}
              align="center"
              fillStyle="rgba(255, 255, 255, 0.8)"
              cornerRadius={4}
              shadowColor="rgba(0, 0, 0, 0.3)"
              shadowBlur={3}
              shadowOffset={{ x: 1, y: 1 }}
              shadowOpacity={0.3}
            />
          )}

          {isSelected && (
            <Circle
              x={robot.position.x}
              y={robot.position.y}
              radius={robotSize + 8}
              stroke="#0066cc"
              strokeWidth={2}
              dash={[5, 5]}
              opacity={0.8}
            />
          )}
        </React.Fragment>
      );
    },
    [
      showLabels,
      showTrajectories,
      showOrientation,
      showStatusIndicators,
      robotSize,
      selectedRobotIds,
      handleRobotClick,
    ]
  );

  return <>{robotPositions.map(renderRobot)}</>;
}

/**
 * Legend component for robot status indicators
 */
export function RobotLegend({
  position = 'top-right',
}: {
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
}) {
  const getPositionStyles = () => {
    switch (position) {
      case 'top-left':
        return { top: 20, left: 20 };
      case 'bottom-right':
        return { bottom: 20, right: 20 };
      case 'bottom-left':
        return { bottom: 20, left: 20 };
      default:
        return { top: 20, right: 20 };
    }
  };

  return (
    <div
      className="absolute bg-white bg-opacity-95 rounded-lg shadow-lg p-4 z-10"
      style={{
        ...getPositionStyles(),
        minWidth: '150px',
      }}
    >
      <div className="text-sm font-semibold mb-2">Robot Status</div>
      <div className="space-y-2">
        {Object.entries(STATUS_COLORS).map(([status, color]) => (
          <div key={status} className="flex items-center space-x-2 text-sm">
            <div
              className="w-4 h-4 rounded-full border border-gray-300"
              style={{ backgroundColor: color }}
            />
            <span className="capitalize">{status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Robot selector component
 */
export function RobotSelector({
  mapId,
  selectedRobotIds,
  onSelectionChange,
  multiSelect = false,
}: {
  mapId: string;
  selectedRobotIds: string[];
  onSelectionChange: (robotIds: string[]) => void;
  multiSelect?: boolean;
}) {
  const { robots, layers } = useMultiMapStore();

  const mapRobots = useMemo(() => {
    return Array.from(robots.values()).filter(robot => {
      const layer = Array.from(layers.values()).find(
        layer =>
          layer.mapId === mapId && layer.type === 'robot' && (layer as any).robotId === robot.id
      );
      return !!layer;
    });
  }, [robots, layers, mapId]);

  const handleRobotToggle = (robotId: string) => {
    if (multiSelect) {
      const newSelection = selectedRobotIds.includes(robotId)
        ? selectedRobotIds.filter(id => id !== robotId)
        : [...selectedRobotIds, robotId];
      onSelectionChange(newSelection);
    } else {
      onSelectionChange(selectedRobotIds.includes(robotId) ? [] : [robotId]);
    }
  };

  if (mapRobots.length === 0) {
    return <div className="text-sm text-gray-500 italic">No robots assigned to this map</div>;
  }

  return (
    <div className="space-y-1">
      {mapRobots.map(robot => {
        const isSelected = selectedRobotIds.includes(robot.id);
        const statusColor = STATUS_COLORS[robot.status] || STATUS_COLORS.unknown;

        return (
          <button
            key={robot.id}
            type="button"
            className={`flex items-center space-x-2 p-2 rounded cursor-pointer transition-colors ${
              isSelected ? 'bg-blue-100 border-blue-300' : 'hover:bg-gray-100'
            } border w-full text-left`}
            onClick={() => handleRobotToggle(robot.id)}
          >
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: statusColor }} />
            <span className="text-sm font-medium">{robot.name || robot.id}</span>
            {isSelected && (
              <div className="ml-auto">
                <div className="w-4 h-4 rounded bg-blue-500 text-white text-xs flex items-center justify-center">
                  ✓
                </div>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
