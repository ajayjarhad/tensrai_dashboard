/**
 * Real-time Integration Example
 * Complete example showing Phase 3 real-time robot integration
 */

import { useEffect, useState } from 'react';
import { MultiMapStage } from '../components/MultiMapStage';
import { useMultiMapManager } from '../hooks/useMultiMapManager';
import { useRealTimeIntegration } from '../hooks/useRealTimeIntegration';
import { positionSynchronizer } from '../services/positionSynchronizer';
import { useMultiMapStore } from '../stores/useMultiMapStore';

export function RealTimeIntegrationExample() {
  const [isROSConnected, setIsROSConnected] = useState(false);
  const [selectedRobot, setSelectedRobot] = useState<string | null>(null);

  const { registerMap, unregisterMap, maps, activeMapId } = useMultiMapManager();

  const { robots } = useMultiMapStore();

  // Real-time integration configuration
  const realTimeIntegration = useRealTimeIntegration({
    rosBridgeUrl: 'ws://localhost:9090',
    enableTelemetry: true,
    enablePositionTracking: true,
    enableAlerts: true,
    telemetryInterval: 1000,
    positionUpdateInterval: 100,
    robotTimeout: 30000,
    autoConnect: false, // We'll connect manually
  });

  // Initialize maps on mount
  useEffect(() => {
    const initializeMaps = async () => {
      try {
        // Register multiple maps
        registerMap('warehouse_map', {
          name: 'Warehouse Floor Plan',
          description: 'Main warehouse operating area',
          yamlPath: '/maps/warehouse.yaml',
          preload: true,
        });

        registerMap('office_map', {
          name: 'Office Floor Plan',
          description: 'Office and meeting rooms',
          yamlPath: '/maps/office.yaml',
          preload: false,
        });

        registerMap('charging_map', {
          name: 'Charging Station',
          description: 'Robot charging and maintenance area',
          yamlPath: '/maps/charging.yaml',
          preload: false,
        });

        console.log('Maps registered successfully');
      } catch (error) {
        console.error('Failed to register maps:', error);
      }
    };

    initializeMaps();

    return () => {
      // Cleanup on unmount
      unregisterMap('warehouse_map');
      unregisterMap('office_map');
      unregisterMap('charging_map');
    };
  }, [registerMap, unregisterMap]);

  // Handle robot selection
  const handleRobotClick = (robotId: string) => {
    setSelectedRobot(robotId);
    console.log('Selected robot:', robotId);
  };

  // Handle coordinate changes
  const handleCoordinateChange = (worldCoords: any, mapId: string) => {
    if (worldCoords) {
      console.log(`Map ${mapId} coordinates:`, worldCoords);
    }
  };

  // Connect to ROS bridge
  const connectToROS = async () => {
    try {
      await realTimeIntegration.connect();
      setIsROSConnected(true);
    } catch (error) {
      console.error('Failed to connect to ROS:', error);
    }
  };

  // Disconnect from ROS bridge
  const disconnectFromROS = () => {
    realTimeIntegration.disconnect();
    setIsROSConnected(false);
  };

  // Send command to selected robot
  const sendRobotCommand = async (command: string) => {
    if (!selectedRobot) {
      alert('Please select a robot first');
      return;
    }

    const success = await realTimeIntegration.sendRobotCommand(selectedRobot, command);
    if (success) {
      console.log(`Command '${command}' sent to robot ${selectedRobot}`);
    } else {
      alert('Failed to send command');
    }
  };

  // Get system statistics
  const getSystemStats = () => {
    const stats = realTimeIntegration.getSystemStats();
    console.log('System Stats:', stats);
    return stats;
  };

  // Get robot statistics
  const getRobotStats = () => {
    const stats: any = {};
    robots.forEach((robot, id) => {
      const positionStats = positionSynchronizer.getInstance().getTrajectoryStats(id);
      stats[id] = {
        name: robot.name,
        status: robot.status,
        lastUpdate: robot.lastUpdate,
        positionStats,
      };
    });
    return stats;
  };

  return (
    <div className="w-full h-screen flex flex-col">
      {/* Header */}
      <div className="bg-gray-800 text-white p-4 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Real-time Robot Integration</h1>
          <p className="text-sm text-gray-300">Phase 3 - Live Robot Monitoring</p>
        </div>

        <div className="flex gap-4 items-center">
          {/* Connection Status */}
          <div className="flex items-center gap-2">
            <div
              className={`w-3 h-3 rounded-full ${isROSConnected ? 'bg-green-500' : 'bg-red-500'}`}
            />
            <span className="text-sm">{isROSConnected ? 'Connected' : 'Disconnected'}</span>
          </div>

          {/* ROS Connection Button */}
          <button
            type="button"
            onClick={isROSConnected ? disconnectFromROS : connectToROS}
            className={`px-4 py-2 rounded text-sm font-medium ${
              isROSConnected ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
            } text-white`}
          >
            {isROSConnected ? 'Disconnect' : 'Connect'} ROS
          </button>

          {/* Stats Button */}
          <button
            type="button"
            onClick={getSystemStats}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium text-white"
          >
            Get Stats
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex">
        {/* Map Stage */}
        <div className="flex-1 relative">
          <MultiMapStage
            width="100%"
            height="100%"
            enableRealTimeIntegration={isROSConnected}
            rosBridgeUrl="ws://localhost:9090"
            enableLayerControls={true}
            enableMapSwitching={true}
            showDebugOverlay={false}
            onCoordinateChange={handleCoordinateChange}
            onRobotClick={handleRobotClick}
          />
        </div>

        {/* Control Panel */}
        <div className="w-80 bg-gray-100 p-4 overflow-y-auto">
          <h2 className="text-lg font-semibold mb-4">Control Panel</h2>

          {/* Robot Status */}
          <div className="mb-6">
            <h3 className="text-md font-medium mb-2">Robot Status</h3>
            <div className="space-y-2">
              {Array.from(robots.entries()).map(([id, robot]) => (
                <button
                  key={id}
                  type="button"
                  className={`p-3 rounded cursor-pointer border ${
                    selectedRobot === id
                      ? 'bg-blue-50 border-blue-300'
                      : 'bg-gray-50 border-gray-200'
                  } w-full text-left`}
                  onClick={() => setSelectedRobot(id)}
                >
                  <div className="flex justify-between items-center">
                    <span className="font-medium">{robot.name || id}</span>
                    <span
                      className={`px-2 py-1 text-xs rounded ${
                        robot.status === 'online'
                          ? 'bg-green-100 text-green-800'
                          : robot.status === 'offline'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-yellow-100 text-yellow-800'
                      }`}
                    >
                      {robot.status}
                    </span>
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    Last Update: {robot.lastUpdate?.toLocaleTimeString() || 'Never'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Map Status */}
          <div className="mb-6">
            <h3 className="text-md font-medium mb-2">Map Status</h3>
            <div className="space-y-2">
              {Array.from(maps.entries()).map(([id, map]) => (
                <div
                  key={id}
                  className={`p-2 rounded border ${
                    activeMapId === id ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white'
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <span className="font-medium">{map.name}</span>
                    <span
                      className={`px-2 py-1 text-xs rounded ${
                        map.loadStatus === 'loaded'
                          ? 'bg-green-100 text-green-800'
                          : map.loadStatus === 'loading'
                            ? 'bg-yellow-100 text-yellow-800'
                            : map.loadStatus === 'error'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {map.loadStatus}
                    </span>
                  </div>
                  {map.assignedRobots.size > 0 && (
                    <div className="text-xs text-gray-600 mt-1">
                      Robots: {Array.from(map.assignedRobots).join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Robot Commands */}
          <div className="mb-6">
            <h3 className="text-md font-medium mb-2">Robot Commands</h3>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => sendRobotCommand('start')}
                disabled={!selectedRobot || !isROSConnected}
                className="w-full px-3 py-2 bg-green-600 text-white rounded disabled:bg-gray-400 text-sm"
              >
                Start Mission
              </button>
              <button
                type="button"
                onClick={() => sendRobotCommand('stop')}
                disabled={!selectedRobot || !isROSConnected}
                className="w-full px-3 py-2 bg-red-600 text-white rounded disabled:bg-gray-400 text-sm"
              >
                Stop Mission
              </button>
              <button
                type="button"
                onClick={() => sendRobotCommand('dock')}
                disabled={!selectedRobot || !isROSConnected}
                className="w-full px-3 py-2 bg-blue-600 text-white rounded disabled:bg-gray-400 text-sm"
              >
                Return to Dock
              </button>
              <button
                type="button"
                onClick={() => sendRobotCommand('pause')}
                disabled={!selectedRobot || !isROSConnected}
                className="w-full px-3 py-2 bg-yellow-600 text-white rounded disabled:bg-gray-400 text-sm"
              >
                Pause
              </button>
            </div>
          </div>

          {/* Statistics */}
          <div className="mb-6">
            <h3 className="text-md font-medium mb-2">Statistics</h3>
            <button
              type="button"
              onClick={getRobotStats}
              className="w-full px-3 py-2 bg-purple-600 text-white rounded text-sm"
            >
              View Robot Statistics
            </button>
          </div>

          {/* System Information */}
          <div>
            <h3 className="text-md font-medium mb-2">System Information</h3>
            <div className="text-sm text-gray-600 space-y-1">
              <div>Total Maps: {maps.size}</div>
              <div>
                Active Maps:{' '}
                {Array.from(maps.values()).filter(m => m.loadStatus === 'loaded').length}
              </div>
              <div>Total Robots: {robots.size}</div>
              <div>Active Robots: {realTimeIntegration.robotsOnline}</div>
              <div>Connected: {isROSConnected ? 'Yes' : 'No'}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RealTimeIntegrationExample;
