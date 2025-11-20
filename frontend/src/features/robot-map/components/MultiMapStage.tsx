/**
 * Multi-Map Stage Component
 * Renders multiple maps with layering, switching, and viewport management
 */

import type {
  AnnotationLayer,
  MapPlacement,
  MapTransforms,
  RobotLayer,
  WorldPoint,
} from '@tensrai/shared';
import type Konva from 'konva';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Image as KonvaImage, Layer, Line, Stage, Text } from 'react-konva';
import { useElementSize } from '../../../hooks/useElementSize';
import {
  canvasToWorld,
  createMapPlacement,
  createMapTransforms,
  worldToCanvas,
} from '../../../lib/map';
import { useMultiMapManager } from '../hooks/useMultiMapManager';
import { useRealTimeIntegration } from '../hooks/useRealTimeIntegration';
import { useCircuitBreaker } from '../services/circuitBreaker';
import { useErrorHandler } from '../services/errorHandler';
import { useMemoryManager } from '../services/memoryManager';
import { usePerformanceOptimizer } from '../services/performanceOptimizer';
import { useRollbackService } from '../services/rollbackService';
import { useStateLogger } from '../services/stateSynchronizer';
import { useMultiMapStore } from '../stores/useMultiMapStore';
import { MapErrorBoundary } from './MapErrorBoundary';
import { RealTimeErrorBoundary } from './RealTimeErrorBoundary';
import { RealTimeRobotOverlay, RobotInfoPanel } from './RealTimeRobotOverlay';

interface MultiMapStageProps {
  width?: number | string;
  height?: number | string;
  className?: string;
  showDebugOverlay?: boolean;
  enableLayerControls?: boolean;
  enableMapSwitching?: boolean;
  enableRealTimeIntegration?: boolean;
  rosBridgeUrl?: string;
  onCoordinateChange?: (worldCoords: WorldPoint | null, mapId: string) => void;
  onRobotClick?: (robotId: string) => void;
}

export function MultiMapStage({
  width = '100%',
  height = '100%',
  className,
  showDebugOverlay = false,
  enableLayerControls = true,
  enableMapSwitching = true,
  enableRealTimeIntegration = false,
  rosBridgeUrl = 'ws://localhost:9090',
  onCoordinateChange,
  onRobotClick,
}: MultiMapStageProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const offscreenCanvasRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const imageRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [selectedRobot, setSelectedRobot] = useState<string | null>(null);
  const [showRobotPanel, setShowRobotPanel] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [mapPlacement, setMapPlacement] = useState<MapPlacement | null>(null);
  const { ref: containerRef, size: containerSize } = useElementSize<HTMLDivElement>();
  const resolvedWidth = typeof width === 'number' ? width : containerSize.width || 800;
  const resolvedHeight = typeof height === 'number' ? height : containerSize.height || 600;
  const containerStyle = {
    width: typeof width === 'number' ? `${width}px` : (width ?? '100%'),
    height: typeof height === 'number' ? `${height}px` : (height ?? '100%'),
  };

  // Error handling and recovery services
  const { handleError } = useErrorHandler();
  const { createSnapshot } = useRollbackService();
  const { getCircuitBreaker } = useCircuitBreaker();

  // Performance optimization
  const { throttle, debounce, batch, recordUpdateTime } = usePerformanceOptimizer();

  // State change logging for debugging
  const { logViewportChange, logRobotChange } = useStateLogger();

  // Memory management
  const { registerResource, unregisterResource } = useMemoryManager();

  // Circuit breaker for map operations
  const mapCircuitBreaker = getCircuitBreaker('map-rendering', {
    failureThreshold: 3,
    resetTimeout: 30000,
    halfOpenMaxCalls: 2,
  });

  const { activeMapId, activeMap, setActiveMap, maps, robotsOnActiveMap, allRobots } =
    useMultiMapManager();

  // Get updateViewport from store directly
  const updateViewport = useMultiMapStore(state => state.updateViewport);

  const { layers, layerOrder } = useMultiMapStore(state => ({
    layers: state.layers,
    layerOrder: state.layerOrder,
  }));

  const mapTransforms = useMemo<MapTransforms | null>(() => {
    return activeMap ? createMapTransforms(activeMap.meta) : null;
  }, [activeMap]);

  const projectWorldPoint = useCallback(
    (point: WorldPoint | null) => {
      if (!point || !mapTransforms || !mapPlacement) {
        return null;
      }
      return worldToCanvas(point, mapTransforms, mapPlacement);
    },
    [mapTransforms, mapPlacement]
  );

  const updatePlacementFromStage = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    setMapPlacement(
      createMapPlacement({
        topLeft: { x: stage.x(), y: stage.y() },
        scale: { x: stage.scaleX(), y: stage.scaleY() },
        rotation: (stage.rotation() * Math.PI) / 180,
      })
    );
  }, []);

  const fitStageToMap = useCallback(() => {
    if (!activeMap || !stageRef.current) {
      return;
    }

    if (resolvedWidth === 0 || resolvedHeight === 0) {
      return;
    }

    const stage = stageRef.current;
    const { width: mapWidth, height: mapHeight } = activeMap.meta;
    const scaleX = resolvedWidth / mapWidth;
    const scaleY = resolvedHeight / mapHeight;
    const fitScale = Math.min(scaleX, scaleY) * 0.9;

    stage.scale({ x: fitScale, y: fitScale });
    stage.position({
      x: (resolvedWidth - mapWidth * fitScale) / 2,
      y: (resolvedHeight - mapHeight * fitScale) / 2,
    });
    stage.batchDraw();
    updatePlacementFromStage();
  }, [activeMap, resolvedWidth, resolvedHeight, updatePlacementFromStage]);

  useEffect(() => {
    fitStageToMap();
  }, [fitStageToMap]);

  useEffect(() => {
    updatePlacementFromStage();
  }, [updatePlacementFromStage]);

  // Real-time integration with error recovery
  const realTimeIntegration = useRealTimeIntegration({
    rosBridgeUrl,
    enableTelemetry: enableRealTimeIntegration,
    enablePositionTracking: enableRealTimeIntegration,
    enableAlerts: enableRealTimeIntegration,
    autoConnect: enableRealTimeIntegration,
  });

  // Create canvas and image for map data
  useEffect(() => {
    if (!activeMap || !activeMapId || !activeMap.imageData) return;

    const createMapImage = async () => {
      try {
        // Create snapshot before map operation
        createSnapshot(`Creating map image for ${activeMapId}`);

        // Execute with circuit breaker protection
        await mapCircuitBreaker.execute(async () => {
          const { imageData } = activeMap;

          // Validate image data
          if (!imageData || !imageData.width || !imageData.height || !imageData.data) {
            throw new Error(`Invalid image data for map: ${activeMapId}`);
          }

          // Cleanup previous canvas if exists
          if (offscreenCanvasRef.current.has(activeMapId)) {
            const oldCanvas = offscreenCanvasRef.current.get(activeMapId);
            if (oldCanvas) {
              oldCanvas.width = 0;
              oldCanvas.height = 0;
            }
            offscreenCanvasRef.current.delete(activeMapId);
          }

          // Create offscreen canvas with error handling
          const canvas = document.createElement('canvas');
          if (!canvas) {
            throw new Error('Failed to create canvas element');
          }

          canvas.width = imageData.width;
          canvas.height = imageData.height;
          offscreenCanvasRef.current.set(activeMapId, canvas);

          // Register canvas with memory manager
          const canvasId = `canvas_${activeMapId}`;
          registerResource(canvasId, 'canvas', canvas);

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            throw new Error('Failed to get 2D context for map rendering');
          }

          // Create ImageData from our custom format with validation
          if (imageData.data.length !== imageData.width * imageData.height * 4) {
            throw new Error('Image data size mismatch');
          }

          const imgData = new ImageData(
            new Uint8ClampedArray(imageData.data),
            imageData.width,
            imageData.height
          );

          ctx.putImageData(imgData, 0, 0);

          // Create image element with timeout
          const img = new Image();
          const imageId = `image_${activeMapId}`;

          // Register image with memory manager
          registerResource(imageId, 'image', img);

          await Promise.race([
            new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = () => reject(new Error('Failed to load image'));
              img.src = canvas.toDataURL();
            }),
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error('Image creation timeout')), 10000)
            ),
          ]);

          imageRef.current.set(activeMapId, img);
        }, `create-map-image-${activeMapId}`);
      } catch (error) {
        // Handle error with comprehensive error recovery
        await handleError(error as Error, {
          component: 'MultiMapStage',
          operation: 'createMapImage',
          mapId: activeMapId,
          imageDataSize: activeMap.imageData?.data?.length,
        });

        // Clean up on error
        offscreenCanvasRef.current.delete(activeMapId);
        imageRef.current.delete(activeMapId);
      }
    };

    createMapImage();

    return () => {
      // Cleanup canvas resource
      const canvas = offscreenCanvasRef.current.get(activeMapId);
      if (canvas) {
        const canvasId = `canvas_${activeMapId}`;
        unregisterResource(canvasId);
        canvas.width = 0;
        canvas.height = 0;
        // Remove canvas context reference
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        offscreenCanvasRef.current.delete(activeMapId);
      }

      // Cleanup image resource
      const img = imageRef.current.get(activeMapId);
      if (img) {
        const imageId = `image_${activeMapId}`;
        unregisterResource(imageId);
        img.onload = null;
        img.onerror = null;
        img.src = '';
        // Force garbage collection
        imageRef.current.delete(activeMapId);
      }
    };
  }, [
    activeMap,
    activeMapId, // Create snapshot before map operation
    createSnapshot,
    handleError,
    mapCircuitBreaker.execute, // Register image with memory manager
    registerResource,
    unregisterResource,
  ]);

  // Handle mouse move for coordinate display with performance optimization
  const handleMouseMove = useCallback(
    throttle(
      'mouse-move',
      (e: Konva.KonvaEventObject<MouseEvent>) => {
        if (!activeMapId || !mapTransforms || !mapPlacement) {
          return;
        }

        const stage = e.target.getStage();
        if (!stage) return;

        const pointer = stage.getPointerPosition();
        if (!pointer) return;

        const worldCoords = canvasToWorld(pointer, mapPlacement, mapTransforms);
        onCoordinateChange?.(worldCoords, activeMapId);
      },
      16
    ),
    []
  );

  const handleMouseLeave = useCallback(() => {
    if (onCoordinateChange && activeMapId) {
      onCoordinateChange(null, activeMapId);
    }
  }, [activeMapId, onCoordinateChange]);

  // Handle stage drag/zoom with performance optimization and state synchronization
  const handleStageChange = useCallback(
    debounce(
      'stage-change',
      () => {
        const startTime = performance.now();

        if (!stageRef.current || !activeMapId) return;

        const stage = stageRef.current;
        const scale = stage.scaleX();
        const x = stage.x();
        const y = stage.y();

        const viewportData = {
          center: { x: -x / scale, y: -y / scale },
          zoom: scale,
          rotation: stage.rotation(),
        };

        // Update local state immediately for responsiveness
        updateViewport(activeMapId, viewportData);

        // Log state change for debugging
        logViewportChange(activeMapId, viewportData, 'MultiMapStage');

        // Batch additional viewport updates if needed
        batch(
          'viewport-update',
          () => {
            // Additional viewport-related operations can go here
          },
          viewportData,
          'high'
        );

        // Record performance
        const updateTime = performance.now() - startTime;
        recordUpdateTime(updateTime);
        updatePlacementFromStage();
      },
      50
    ),
    []
  );

  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) {
        return;
      }

      const oldScale = stage.scaleX();
      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const scaleBy = 1.05;
      const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
      const clampedScale = Math.max(0.1, Math.min(10, newScale));

      const newPos = {
        x: pointer.x - (pointer.x - stage.x()) * (clampedScale / oldScale),
        y: pointer.y - (pointer.y - stage.y()) * (clampedScale / oldScale),
      };

      stage.scale({ x: clampedScale, y: clampedScale });
      stage.position(newPos);
      stage.batchDraw();
      updatePlacementFromStage();
      handleStageChange();
    },
    [handleStageChange, updatePlacementFromStage]
  );

  const rotateStageView = useCallback((delta: number) => {
    setRotation(prev => prev + delta);
  }, []);

  const resetView = useCallback(() => {
    setRotation(0);
    fitStageToMap();
  }, [fitStageToMap]);

  // Handle map switching
  const handleMapSwitch = useCallback(
    (mapId: string) => {
      setActiveMap(mapId);
    },
    [setActiveMap]
  );

  // Handle robot click with state synchronization
  const handleRobotClick = useCallback(
    (robotId: string) => {
      // Update local state immediately
      setSelectedRobot(robotId);
      setShowRobotPanel(true);

      // Synchronize robot interaction across phases
      const store = useMultiMapStore.getState();
      const robot = store.robots.get(robotId);
      if (robot) {
        logRobotChange(
          robotId,
          {
            ...robot,
            lastInteraction: Date.now(),
          },
          'MultiMapStage'
        );
      }

      onRobotClick?.(robotId);
    },
    [onRobotClick, logRobotChange]
  );

  // Handle robot panel close
  const handleRobotPanelClose = useCallback(() => {
    setShowRobotPanel(false);
    setSelectedRobot(null);
  }, []);

  // Cleanup all resources on unmount
  useEffect(() => {
    return () => {
      // Clean up all canvas resources
      offscreenCanvasRef.current.forEach((canvas, mapId) => {
        const canvasId = `canvas_${mapId}`;
        unregisterResource(canvasId);
        canvas.width = 0;
        canvas.height = 0;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      });
      offscreenCanvasRef.current.clear();

      // Clean up all image resources
      imageRef.current.forEach((img, mapId) => {
        const imageId = `image_${mapId}`;
        unregisterResource(imageId);
        img.onload = null;
        img.onerror = null;
        img.src = '';
      });
      imageRef.current.clear();

      // Clean up Konva stage
      if (stageRef.current) {
        const stageId = `stage_main`;
        registerResource(stageId, 'animation', stageRef.current);
        stageRef.current.destroy();
        stageRef.current = null;
      }

      // Clean up memory manager
      // Resources are unregistered individually
    };
  }, [registerResource, unregisterResource]);

  // Render robot layers
  const renderRobotLayer = useCallback(
    (layer: RobotLayer) => {
      const robot = allRobots.get(layer.robotId);
      if (!robot || !robot.currentPose || robot.status !== 'online') return null;

      const { position } = robot.currentPose.pose;
      const worldPoint = { x: position.x, y: position.y };
      const canvasPoint = projectWorldPoint(worldPoint);
      if (!canvasPoint) {
        return null;
      }

      return (
        <Layer key={layer.id} visible={layer.visible} opacity={layer.opacity}>
          {layer.showLabel && (
            <Text
              x={canvasPoint.x + (layer.labelOffset?.x || 0)}
              y={canvasPoint.y + (layer.labelOffset?.y || -20)}
              text={robot.name || layer.robotId}
              fontSize={12}
              fill={layer.color || '#00ff00'}
              padding={2}
              fillStyle="rgba(0, 0, 0, 0.5)"
            />
          )}
          <Circle
            x={canvasPoint.x}
            y={canvasPoint.y}
            radius={8}
            fill={layer.color || '#00ff00'}
            stroke="black"
            strokeWidth={2}
          />
          {layer.showTrajectory && (
            // Add trajectory rendering here based on stored positions
            <Line
              points={[]} // Would be populated with trajectory points
              stroke={layer.color || '#00ff00'}
              strokeWidth={2}
              opacity={0.5}
            />
          )}
        </Layer>
      );
    },
    [allRobots, projectWorldPoint]
  );

  // Render annotation layers
  const renderAnnotationLayer = useCallback(
    (layer: AnnotationLayer) => {
      return (
        <Layer key={layer.id} visible={layer.visible} opacity={layer.opacity}>
          {layer.annotations.map(annotation => {
            const canvasPoint = projectWorldPoint(annotation.position);
            if (!canvasPoint) {
              return null;
            }

            switch (annotation.type) {
              case 'waypoint':
                return (
                  <Circle
                    key={annotation.id}
                    x={canvasPoint.x}
                    y={canvasPoint.y}
                    radius={5}
                    fill="red"
                    stroke="white"
                    strokeWidth={2}
                  />
                );
              case 'marker':
                return (
                  <Circle
                    key={annotation.id}
                    x={canvasPoint.x}
                    y={canvasPoint.y}
                    radius={3}
                    fill="yellow"
                  />
                );
              default:
                return null;
            }
          })}
        </Layer>
      );
    },
    [projectWorldPoint]
  );

  // Render layers in correct order with performance optimization
  const renderLayers = useMemo(() => {
    const startTime = performance.now();

    if (!activeMapId) return null;

    // Cache layer filtering and sorting
    const activeMapLayers = Array.from(layers.values())
      .filter(layer => layer.mapId === activeMapId)
      .sort((a, b) => layerOrder.indexOf(a.id) - layerOrder.indexOf(b.id));

    const renderedLayers = activeMapLayers
      .map(layer => {
        if (layer.type === 'robot') {
          return renderRobotLayer(layer as RobotLayer);
        } else if (layer.type === 'annotation') {
          return renderAnnotationLayer(layer as AnnotationLayer);
        }
        return null;
      })
      .filter(Boolean); // Remove null entries

    // Record performance
    const renderTime = performance.now() - startTime;
    recordUpdateTime(renderTime);

    return renderedLayers;
  }, [layers, layerOrder, activeMapId, renderRobotLayer, renderAnnotationLayer, recordUpdateTime]);

  // Map switching controls
  const mapSwitcher = useMemo(() => {
    if (!enableMapSwitching) return null;

    return (
      <div className="absolute top-4 right-4 bg-white bg-opacity-95 rounded-lg shadow-lg p-3">
        <div className="text-sm font-semibold mb-2">Maps</div>
        <div className="space-y-1">
          {Array.from(maps.entries()).map(([mapId, map]) => (
            <button
              type="button"
              key={mapId}
              onClick={() => handleMapSwitch(mapId)}
              className={`w-full text-left px-3 py-2 rounded transition-colors ${
                activeMapId === mapId
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-800'
              } ${map.loadStatus === 'error' ? 'border-l-4 border-red-500' : ''}`}
            >
              <div className="font-medium">{map.name}</div>
              {map.loadStatus === 'loading' && <div className="text-xs opacity-75">Loading...</div>}
              {map.loadStatus === 'error' && (
                <div className="text-xs text-red-600">Error: {map.loadError}</div>
              )}
              {map.assignedRobots.size > 0 && (
                <div className="text-xs opacity-75">
                  {map.assignedRobots.size} robot{map.assignedRobots.size !== 1 ? 's' : ''}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }, [enableMapSwitching, maps, activeMapId, handleMapSwitch]);

  if (!activeMap) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-100 ${className || ''}`}
        style={containerStyle}
      >
        <div className="text-center">
          <div className="text-gray-500 mb-2">No active map selected</div>
          <div className="text-sm text-gray-400">
            Select a map from the switcher or register a new map
          </div>
        </div>
      </div>
    );
  }

  const mapImage = activeMapId ? imageRef.current.get(activeMapId) : undefined;

  return (
    <MapErrorBoundary>
      <RealTimeErrorBoundary>
        <div ref={containerRef} className={`relative ${className || ''}`} style={containerStyle}>
          <Stage
            ref={stageRef}
            width={resolvedWidth}
            height={resolvedHeight}
            rotation={rotation}
            draggable
            onTransform={handleStageChange}
            onDragEnd={handleStageChange}
            onDragMove={handleStageChange}
            onWheel={handleWheel}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            {/* Base map layer */}
            <Layer>{mapImage && <KonvaImage image={mapImage} x={0} y={0} />}</Layer>

            {/* Real-time robot overlay */}
            {enableRealTimeIntegration && activeMapId && mapTransforms && mapPlacement && (
              <RealTimeRobotOverlay
                mapId={activeMapId}
                mapTransforms={mapTransforms}
                mapPlacement={mapPlacement}
                showTrajectories={true}
                showTelemetry={true}
                showLabels={true}
                trajectoryLength={50}
                onRobotClick={handleRobotClick}
              />
            )}

            {/* Dynamic layers */}
            {renderLayers}

            {/* Debug overlay */}
            {showDebugOverlay && (
              <Layer>
                <Text
                  x={10}
                  y={10}
                  text={`Map: ${activeMapId}`}
                  fontSize={14}
                  fill="white"
                  padding={4}
                  fillStyle="rgba(0, 0, 0, 0.7)"
                />
                <Text
                  x={10}
                  y={30}
                  text={`Robots: ${robotsOnActiveMap.length}`}
                  fontSize={14}
                  fill="white"
                  padding={4}
                  fillStyle="rgba(0, 0, 0, 0.7)"
                />
                <Text
                  x={10}
                  y={50}
                  text={`Layers: ${layers.size}`}
                  fontSize={14}
                  fill="white"
                  padding={4}
                  fillStyle="rgba(0, 0, 0, 0.7)"
                />
                <Text
                  x={10}
                  y={70}
                  text={`Rotation: ${rotation.toFixed(1)}°`}
                  fontSize={14}
                  fill="white"
                  padding={4}
                  fillStyle="rgba(0, 0, 0, 0.7)"
                />
              </Layer>
            )}
          </Stage>

          {/* Map switcher */}
          {mapSwitcher}

          {/* Real-time status indicator */}
          {enableRealTimeIntegration && (
            <div className="absolute top-4 left-4 bg-white bg-opacity-95 rounded-lg shadow-lg p-3">
              <div className="text-sm font-semibold mb-2">Real-time Status</div>
              <div className="space-y-1 text-xs">
                <div className="flex items-center">
                  <div
                    className={`w-3 h-3 rounded-full mr-2 ${realTimeIntegration.isConnected ? 'bg-green-500' : 'bg-red-500'}`}
                  />
                  {realTimeIntegration.isConnected ? 'Connected' : 'Disconnected'}
                </div>
                <div>Robots: {realTimeIntegration.robotsOnline}</div>
                <div>
                  Last Update:{' '}
                  {realTimeIntegration.status.lastUpdate?.toLocaleTimeString() || 'Never'}
                </div>
              </div>
            </div>
          )}

          {/* Robot info panel */}
          {showRobotPanel && selectedRobot && (
            <Layer>
              <RobotInfoPanel
                robotId={selectedRobot}
                onClose={handleRobotPanelClose}
                position={{ x: 50, y: 50 }}
              />
            </Layer>
          )}

          {/* Layer controls */}
          {enableLayerControls && layers.size > 0 && (
            <div className="absolute top-4 left-4 bg-white bg-opacity-95 rounded-lg shadow-lg p-3 max-w-xs">
              <div className="text-sm font-semibold mb-2">Layers</div>
              <div className="space-y-1">
                {Array.from(layers.values())
                  .filter(layer => layer.mapId === activeMapId)
                  .map(layer => (
                    <div key={layer.id} className="flex items-center justify-between text-sm">
                      <span className="truncate flex-1">{layer.name}</span>
                      <span
                        className={`w-3 h-3 rounded-full ml-2 ${
                          layer.visible ? 'bg-green-500' : 'bg-gray-300'
                        }`}
                        title={layer.visible ? 'Visible' : 'Hidden'}
                      />
                    </div>
                  ))}
              </div>
            </div>
          )}
          <div className="absolute bottom-4 right-4 flex flex-col items-end gap-2">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => rotateStageView(-15)}
                className="bg-gray-800 text-white px-3 py-2 rounded shadow hover:bg-gray-700 text-xs font-medium transition-colors"
              >
                Rotate -15°
              </button>
              <button
                type="button"
                onClick={() => rotateStageView(15)}
                className="bg-gray-800 text-white px-3 py-2 rounded shadow hover:bg-gray-700 text-xs font-medium transition-colors"
              >
                Rotate +15°
              </button>
            </div>
            <button
              type="button"
              onClick={resetView}
              className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded shadow-lg text-sm font-medium transition-colors"
            >
              Reset View
            </button>
          </div>
        </div>
      </RealTimeErrorBoundary>
    </MapErrorBoundary>
  );
}
