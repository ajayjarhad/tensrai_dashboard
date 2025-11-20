/**
 * Real-time Robot Overlay Component
 * Renders robots with real-time position updates, trajectories, and telemetry
 */

import type {
  CanvasPoint,
  MapPlacement,
  MapTransforms,
  RobotInfo,
  WorldPoint,
} from '@tensrai/shared';
import type Konva from 'konva';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Arrow, Circle, Group, Layer, Line, Rect, Text } from 'react-konva';
import { worldToCanvas } from '../../../lib/map';
import { useAlertSystem } from '../services/alertSystem';
import type { TrajectoryPoint } from '../services/positionSynchronizer';
import { usePositionSynchronizer } from '../services/positionSynchronizer';
import { useRobotTelemetry } from '../services/robotTelemetry';
import { useMultiMapStore } from '../stores/useMultiMapStore';

interface RealTimeRobotOverlayProps {
  mapId: string;
  mapTransforms: MapTransforms;
  mapPlacement: MapPlacement;
  showTrajectories?: boolean;
  showTelemetry?: boolean;
  showLabels?: boolean;
  trajectoryLength?: number;
  updateInterval?: number;
  onRobotClick?: (robotId: string) => void;
}

interface RobotRenderData {
  robot: RobotInfo;
  telemetry?: {
    battery?: {
      level: number;
      voltage: number;
      charging: boolean;
    };
    system?: {
      cpuUsage: number;
      memoryUsage: number;
      temperature: number;
    };
  };
  trajectory: TrajectoryPoint[];
  alerts: Array<{
    id: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    title: string;
    message: string;
    resolved: boolean;
  }>;
  color: string;
  isVisible: boolean;
  speed: number;
}

export function RealTimeRobotOverlay({
  mapId,
  mapTransforms,
  mapPlacement,
  showTrajectories = true,
  showTelemetry = true,
  showLabels = true,
  trajectoryLength = 50,
  updateInterval = 100,
  onRobotClick,
}: RealTimeRobotOverlayProps) {
  const {
    robots,
    assignments,
    // updateRobotPose,
  } = useMultiMapStore();

  const {
    getTrajectory,
    // getAllTrajectories,
    calculateSpeed,
    isActive,
    onTrajectoryUpdate,
  } = usePositionSynchronizer();

  const {
    getLatestTelemetry,
    // getRobotStats,
  } = useRobotTelemetry();

  const { getRobotAlerts } = useAlertSystem();

  const layerRef = useRef<Konva.Layer>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const lastUpdateRef = useRef<number>(Date.now());

  // Get robot color based on ID
  const getRobotColor = useCallback((robotId: string): string => {
    const colors = [
      '#00ff00',
      '#ff0000',
      '#0000ff',
      '#ffff00',
      '#ff00ff',
      '#00ffff',
      '#ff8800',
      '#8800ff',
      '#00ff88',
      '#ff0088',
    ];

    let hash = 0;
    for (let i = 0; i < robotId.length; i++) {
      hash = (hash << 5) - hash + robotId.charCodeAt(i);
    }
    return colors[Math.abs(hash) % colors.length];
  }, []);

  const projectWorldPoint = useCallback(
    (point?: WorldPoint) => {
      if (!point) {
        return null;
      }
      return worldToCanvas(point, mapTransforms, mapPlacement);
    },
    [mapTransforms, mapPlacement]
  );

  // Get robots assigned to this map
  const mapRobots = useMemo(() => {
    return Array.from(assignments.values())
      .filter(assignment => assignment.mapId === mapId && assignment.status === 'active')
      .map(assignment => robots.get(assignment.robotId))
      .filter(Boolean) as RobotInfo[];
  }, [robots, assignments, mapId]);

  // Prepare robot render data
  const robotRenderData = useMemo((): RobotRenderData[] => {
    return mapRobots.map(robot => {
      const trajectory = getTrajectory(robot.id).slice(-trajectoryLength);
      const telemetryData = getLatestTelemetry(robot.id);
      const alerts = getRobotAlerts(robot.id).filter(alert => !alert.resolved);
      const speed = calculateSpeed(robot.id);
      const isActiveRobot = isActive(robot.id);
      const color = getRobotColor(robot.id);

      return {
        robot,
        ...(telemetryData ? { telemetry: telemetryData } : {}),
        trajectory,
        alerts,
        color,
        isVisible: isActiveRobot && robot.currentPose !== undefined,
        speed,
      };
    });
  }, [
    mapRobots,
    getTrajectory,
    getLatestTelemetry,
    getRobotAlerts,
    calculateSpeed,
    isActive,
    trajectoryLength,
    getRobotColor,
  ]);

  // Render robot trajectory
  const renderTrajectory = useCallback(
    (trajectory: TrajectoryPoint[], color: string) => {
      const canvasPoints = trajectory
        .map(point => projectWorldPoint(point.position))
        .filter((pt): pt is CanvasPoint => Boolean(pt));

      if (canvasPoints.length < 2) return null;

      const points = canvasPoints.flatMap(point => [point.x, point.y]);

      return (
        <Line
          points={points}
          stroke={color}
          strokeWidth={2}
          opacity={0.6}
          lineCap="round"
          lineJoin="round"
          dash={[5, 5]}
        />
      );
    },
    [projectWorldPoint]
  );

  // Render robot with telemetry
  const renderRobot = useCallback(
    (renderData: RobotRenderData) => {
      const { robot, telemetry, alerts, color, isVisible, speed } = renderData;

      if (!isVisible || !robot.currentPose) {
        return null;
      }

      const { position } = robot.currentPose.pose;
      const worldPosition = { x: position.x, y: position.y };
      const canvasPosition = projectWorldPoint(worldPosition);
      if (!canvasPosition) {
        return null;
      }
      const robotRadius = 12;

      // Calculate rotation from quaternion if available
      let rotation = 0;
      if (robot.currentPose.pose.orientation) {
        const q = robot.currentPose.pose.orientation;
        rotation = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
      }

      // Determine robot status based on alerts and telemetry
      let statusColor = color;
      let statusSymbol = '●';

      if (alerts.some(alert => alert.severity === 'critical')) {
        statusColor = '#ff0000';
        statusSymbol = '⚠';
      } else if (alerts.some(alert => alert.severity === 'high')) {
        statusColor = '#ff8800';
        statusSymbol = '⚠';
      } else if (!isActive(robot.id)) {
        statusColor = '#888888';
        statusSymbol = '○';
      }

      return (
        <Group key={robot.id}>
          {/* Trajectory */}
          {showTrajectories && renderTrajectory(renderData.trajectory, color)}

          {/* Robot body */}
          <Circle
            x={canvasPosition.x}
            y={canvasPosition.y}
            radius={robotRadius}
            fill={statusColor}
            stroke="black"
            strokeWidth={2}
            shadowColor="rgba(0,0,0,0.3)"
            shadowBlur={4}
            shadowOffset={{ x: 2, y: 2 }}
            onClick={() => onRobotClick?.(robot.id)}
            onTap={() => onRobotClick?.(robot.id)}
            onMouseEnter={e => {
              const container = e.target.getStage()?.container();
              if (container) {
                container.style.cursor = 'pointer';
              }
            }}
            onMouseLeave={e => {
              const container = e.target.getStage()?.container();
              if (container) {
                container.style.cursor = 'default';
              }
            }}
          />

          {/* Direction indicator */}
          <Arrow
            x={canvasPosition.x}
            y={canvasPosition.y}
            points={[
              0,
              0,
              Math.cos(rotation) * robotRadius * 0.8,
              Math.sin(rotation) * robotRadius * 0.8,
            ]}
            pointerLength={4}
            pointerWidth={4}
            stroke="white"
            strokeWidth={2}
            fill="white"
          />

          {/* Robot label */}
          {showLabels && (
            <Text
              x={canvasPosition.x}
              y={canvasPosition.y - robotRadius - 15}
              text={`${robot.name || robot.id} ${statusSymbol}`}
              fontSize={11}
              fill="black"
              stroke="white"
              strokeWidth={3}
              strokeEnabled={true}
              padding={2}
              align="center"
              fontStyle="bold"
            />
          )}

          {/* Speed indicator */}
          {showTelemetry && speed > 0.1 && (
            <Text
              x={canvasPosition.x}
              y={canvasPosition.y + robotRadius + 15}
              text={`${speed.toFixed(1)} m/s`}
              fontSize={9}
              fill={color}
              stroke="white"
              strokeWidth={2}
              strokeEnabled={true}
              padding={1}
              align="center"
            />
          )}

          {/* Battery indicator */}
          {showTelemetry && telemetry?.battery && (
            <Group x={canvasPosition.x + robotRadius + 5} y={canvasPosition.y - 10}>
              <Rect width={20} height={8} fill="black" stroke="black" strokeWidth={1} />
              <Rect
                x={1}
                y={1}
                width={Math.max(1, 18 * (telemetry.battery.level / 100))}
                height={6}
                fill={telemetry.battery.level > 20 ? '#00ff00' : '#ff0000'}
              />
            </Group>
          )}

          {/* Alert indicator */}
          {alerts.length > 0 && (
            <Circle
              x={canvasPosition.x - robotRadius - 5}
              y={canvasPosition.y - robotRadius - 5}
              radius={4}
              fill={alerts.some(a => a.severity === 'critical') ? '#ff0000' : '#ff8800'}
              stroke="white"
              strokeWidth={1}
            />
          )}
        </Group>
      );
    },
    [
      showTrajectories,
      showTelemetry,
      showLabels,
      renderTrajectory,
      onRobotClick,
      isActive,
      projectWorldPoint,
    ]
  );

  // Animation loop for smooth updates
  const animate = useCallback(() => {
    const now = Date.now();
    const deltaTime = now - lastUpdateRef.current;

    if (deltaTime >= updateInterval) {
      // Force layer redraw
      if (layerRef.current) {
        layerRef.current.batchDraw();
      }
      lastUpdateRef.current = now;
    }

    animationFrameRef.current = requestAnimationFrame(animate);
  }, [updateInterval]);

  // Setup animation and subscriptions
  useEffect(() => {
    // Start animation loop
    animationFrameRef.current = requestAnimationFrame(animate);

    // Subscribe to trajectory updates
    const unsubscribeTrajectory = onTrajectoryUpdate((_robotId, _trajectory) => {
      // Trigger re-render by updating layer
      if (layerRef.current) {
        layerRef.current.batchDraw();
      }
    });

    return () => {
      // Cleanup animation frame
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }

      // Unsubscribe from trajectory updates
      unsubscribeTrajectory();

      // Clear layer references
      if (layerRef.current) {
        layerRef.current.destroy();
        layerRef.current = null;
      }
    };
  }, [animate, onTrajectoryUpdate]);

  // Render all robots
  const renderRobots = useMemo(() => {
    return robotRenderData.map(renderData => renderRobot(renderData));
  }, [robotRenderData, renderRobot]);

  return <Layer ref={layerRef}>{renderRobots}</Layer>;
}

/**
 * Enhanced Robot Info Panel
 * Shows detailed robot information and telemetry
 */
interface RobotInfoPanelProps {
  robotId: string;
  onClose: () => void;
  position: { x: number; y: number };
}

export function RobotInfoPanel({ robotId, onClose, position }: RobotInfoPanelProps) {
  const { robots } = useMultiMapStore();
  const { getLatestTelemetry, getRobotStats } = useRobotTelemetry();
  const { getRobotAlerts } = useAlertSystem();

  const robot = robots.get(robotId);
  const telemetry = getLatestTelemetry(robotId);
  const stats = getRobotStats(robotId);
  const alerts = getRobotAlerts(robotId);

  if (!robot) return null;

  return (
    <Group>
      {/* Background panel */}
      <Rect
        x={position.x}
        y={position.y}
        width={300}
        height={Math.min(400, 120 + alerts.length * 30)}
        fill="white"
        stroke="black"
        strokeWidth={2}
        cornerRadius={8}
        shadowColor="rgba(0,0,0,0.3)"
        shadowBlur={8}
        shadowOffset={{ x: 4, y: 4 }}
      />

      {/* Close button */}
      <Circle
        x={position.x + 285}
        y={position.y + 15}
        radius={10}
        fill="#ff0000"
        stroke="black"
        strokeWidth={1}
        onClick={onClose}
        onTap={onClose}
        onMouseEnter={e => {
          const container = e.target.getStage()?.container();
          if (container) {
            container.style.cursor = 'pointer';
          }
        }}
        onMouseLeave={e => {
          const container = e.target.getStage()?.container();
          if (container) {
            container.style.cursor = 'default';
          }
        }}
      />
      <Text
        x={position.x + 285}
        y={position.y + 15}
        text="✕"
        fontSize={14}
        fill="white"
        align="center"
        offsetX={5}
        offsetY={5}
      />

      {/* Robot name */}
      <Text
        x={position.x + 20}
        y={position.y + 20}
        text={robot.name || robotId}
        fontSize={18}
        fill="black"
        fontStyle="bold"
      />

      {/* Status indicator */}
      <Circle
        x={position.x + 20}
        y={position.y + 50}
        radius={6}
        fill={telemetry ? '#00ff00' : '#888888'}
        stroke="black"
        strokeWidth={1}
      />
      <Text
        x={position.x + 35}
        y={position.y + 55}
        text={telemetry ? 'Online' : 'Offline'}
        fontSize={12}
        fill="black"
      />

      {/* Position */}
      {robot.currentPose && (
        <Text
          x={position.x + 20}
          y={position.y + 75}
          text={`Position: (${robot.currentPose.pose.position.x.toFixed(2)}, ${robot.currentPose.pose.position.y.toFixed(2)})`}
          fontSize={10}
          fill="black"
        />
      )}

      {/* Battery */}
      {telemetry?.battery && (
        <Text
          x={position.x + 20}
          y={position.y + 95}
          text={`Battery: ${telemetry.battery.level.toFixed(1)}% (${telemetry.battery.voltage.toFixed(1)}V)`}
          fontSize={10}
          fill="black"
        />
      )}

      {/* Stats */}
      {stats && (
        <>
          <Text
            x={position.x + 20}
            y={position.y + 115}
            text={`Distance: ${stats.distanceTraveled.toFixed(1)}m | Avg Speed: ${stats.averageSpeed.toFixed(2)}m/s`}
            fontSize={10}
            fill="black"
          />
          <Text
            x={position.x + 20}
            y={position.y + 130}
            text={`Uptime: ${Math.floor(stats.uptime / 3600)}h ${Math.floor((stats.uptime % 3600) / 60)}m`}
            fontSize={10}
            fill="black"
          />
        </>
      )}

      {/* Alerts */}
      {alerts.length > 0 && (
        <>
          <Text
            x={position.x + 20}
            y={position.y + 150}
            text="Alerts:"
            fontSize={12}
            fill="black"
            fontStyle="bold"
          />
          {alerts.slice(0, 5).map((alert, index) => (
            <Text
              key={alert.id}
              x={position.x + 30}
              y={position.y + 165 + index * 20}
              text={`${alert.severity}: ${alert.title}`}
              fontSize={9}
              fill={
                alert.severity === 'critical'
                  ? '#ff0000'
                  : alert.severity === 'high'
                    ? '#ff8800'
                    : '#000000'
              }
              width={260}
              ellipsis={true}
            />
          ))}
        </>
      )}
    </Group>
  );
}
