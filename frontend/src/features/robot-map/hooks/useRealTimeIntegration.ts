/**
 * Real-time Integration Hook
 * Orchestrates all real-time robot integration features
 */

import type { ROSPoseStamped } from '@tensrai/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { alertManager, useAlertSystem } from '../services/alertSystem';
import { useErrorHandler } from '../services/errorHandler';
import { usePerformanceOptimizer } from '../services/performanceOptimizer';
import { usePositionSynchronizer } from '../services/positionSynchronizer';
import { useRobotTelemetry } from '../services/robotTelemetry';
import { useMultiMapStore } from '../stores/useMultiMapStore';
import type { RobotTelemetry as TelemetryData } from '../types/telemetry';
import { useROSClient } from './useROSClient';

export interface RealTimeIntegrationConfig {
  rosBridgeUrl: string;
  enableTelemetry?: boolean;
  enablePositionTracking?: boolean;
  enableAlerts?: boolean;
  telemetryInterval?: number;
  positionUpdateInterval?: number;
  robotTimeout?: number;
  autoConnect?: boolean;
  authToken?: string;
  maxRetries?: number;
  retryDelay?: number;
}

export interface RealTimeStatus {
  connected: boolean;
  robotsOnline: number;
  lastUpdate: Date | null;
  errors: string[];
  dataPointsReceived: number;
  alertsTriggered: number;
}

export function useRealTimeIntegration(config: RealTimeIntegrationConfig) {
  const {
    enableTelemetry = true,
    enablePositionTracking = true,
    enableAlerts = true,
    robotTimeout = 30000,
    autoConnect = true,
  } = config;

  const {
    updateRobot,
    robots,
    // assignments,
  } = useMultiMapStore();

  const rosClient = useROSClient({
    url: config.rosBridgeUrl,
    reconnectAttempts: 5,
    connectionTimeout: 5000,
  });
  const positionSynchronizer = usePositionSynchronizer();
  const telemetry = useRobotTelemetry();
  const alertSystem = useAlertSystem();
  const { handleError } = useErrorHandler();
  const { throttle } = usePerformanceOptimizer();

  const [status, setStatus] = useState<RealTimeStatus>({
    connected: false,
    robotsOnline: 0,
    lastUpdate: null,
    errors: [],
    dataPointsReceived: 0,
    alertsTriggered: 0,
  });

  const [isInitialized, setIsInitialized] = useState(false);
  const activeRobots = useRef(new Set<string>());
  const robotTimers = useRef(new Map<string, number>());
  const dataPointCounter = useRef(0);
  const alertCounter = useRef(0);

  // Clear robot timer
  const clearRobotTimer = useCallback((robotId: string) => {
    const timer = robotTimers.current.get(robotId);
    if (timer) {
      clearTimeout(timer);
      robotTimers.current.delete(robotId);
    }
  }, []);

  // Set robot timeout for offline detection
  const setRobotTimeout = useCallback(
    (robotId: string) => {
      clearRobotTimer(robotId);

      const timer = setTimeout(() => {
        if (activeRobots.current.has(robotId)) {
          activeRobots.current.delete(robotId);

          if (enableAlerts) {
            alertManager.createConnectivityAlert(robotId, 'disconnected');
          }

          setStatus(prev => ({
            ...prev,
            robotsOnline: activeRobots.current.size,
          }));
        }
      }, robotTimeout) as unknown as number;

      robotTimers.current.set(robotId, timer);
    },
    [robotTimeout, enableAlerts, clearRobotTimer]
  );

  // Update robot pose and trigger position synchronizer
  const updateRobotPose = useCallback(
    (robotId: string, pose: ROSPoseStamped) => {
      updateRobot(robotId, {
        currentPose: pose,
        lastUpdate: new Date(),
        status: 'online',
      });

      // Update position synchronizer
      positionSynchronizer.updateRobotPosition(robotId, pose);

      // Reset robot timeout
      if (activeRobots.current.has(robotId)) {
        setRobotTimeout(robotId);
      }
    },
    [updateRobot, positionSynchronizer, setRobotTimeout]
  );

  // Handle TF messages for robot poses
  const handleTFMessage = useCallback(
    (msg: any) => {
      const { transforms } = msg;

      transforms.forEach((transform: any) => {
        const { header, child_frame_id, transform: tf } = transform;

        // Extract robot ID from frame ID
        const robotId = child_frame_id.split('/')[0];

        if (robotId && child_frame_id.includes('base_link')) {
          const pose: ROSPoseStamped = {
            header: {
              seq: header.seq,
              stamp: {
                secs: header.stamp.secs,
                nsecs: header.stamp.nsecs,
              },
              frame_id: header.frame_id,
            },
            pose: {
              position: {
                x: tf.translation.x,
                y: tf.translation.y,
                z: tf.translation.z,
              },
              orientation: tf.rotation,
            },
          };

          updateRobotPose(robotId, pose);
        }
      });
    },
    [updateRobotPose]
  );

  // Handle individual robot pose messages
  const handleRobotPoseMessage = useCallback(
    (robotId: string, poseTopic: string) => (msg: any) => {
      try {
        const pose: ROSPoseStamped = {
          header: msg.header,
          pose: msg.pose,
        };

        updateRobotPose(robotId, pose);
      } catch (error) {
        handleError(error as Error, {
          component: 'RealTimeIntegration',
          action: 'handlePoseMessage',
          context: { robotId, topic: poseTopic },
        });
      }
    },
    [updateRobotPose, handleError]
  );

  // Handle telemetry messages with performance optimization
  const handleTelemetryMessage = useCallback(
    throttle('telemetry-message', (robotId: string, msg: any) => {
      try {
        const telemetryData: TelemetryData = {
          robotId,
          timestamp: new Date(),
          pose: msg.pose,
          velocity: msg.velocity || { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } },
          battery: {
            level: msg.battery?.level || 0,
            voltage: msg.battery?.voltage || 0,
            current: 0,
            charging: false,
          },
          sensors: {
            bumper: false,
            cliff: false,
            wheelDrop: false,
            irSensor: [],
            ultrasonic: [],
          },
          navigation: {
            state: 'idle',
            goalReached: false,
            replanningCount: 0,
          },
          system: {
            cpuUsage: 0,
            memoryUsage: 0,
            temperature: 0,
            uptime: 0,
          },
          connectivity: {
            wifiSignal: 0,
            connectionQuality: 'good',
            latency: 0,
            packetLoss: 0,
            lastPingTime: new Date(),
          },
          tasks: {
            taskProgress: 0,
            tasksCompleted: 0,
            tasksFailed: 0,
            totalDistanceTraveled: 0,
          },
        };

        telemetry.addTelemetry(telemetryData as any);
        dataPointCounter.current++;

        setStatus(prev => ({
          ...prev,
          dataPointsReceived: dataPointCounter.current,
          lastUpdate: new Date(),
        }));
      } catch (error) {
        handleError(error as Error, {
          component: 'RealTimeIntegration',
          action: 'handleTelemetryMessage',
          context: { robotId },
        });
      }
    }),
    []
  );

  // Handle offline status
  const handleOfflineStatus = useCallback(
    (robotId: string) => {
      // Create connectivity alert
      if (enableAlerts) {
        alertManager.createConnectivityAlert(robotId, 'disconnected');
      }

      // Remove from active robots
      activeRobots.current.delete(robotId);
      clearRobotTimer(robotId);
    },
    [enableAlerts, clearRobotTimer]
  );

  // Handle online status
  const handleOnlineStatus = useCallback(
    (robotId: string) => {
      // Add to active robots
      if (!activeRobots.current.has(robotId)) {
        activeRobots.current.add(robotId);
        setRobotTimeout(robotId);

        // Create connectivity alert
        if (enableAlerts) {
          alertManager.createConnectivityAlert(robotId, 'connected');
        }
      }
    },
    [enableAlerts, setRobotTimeout]
  );

  // Handle robot status messages
  const handleRobotStatusMessage = useCallback(
    (robotId: string, msg: any) => {
      try {
        const { status, error } = msg;

        if (status === 'offline' || error) {
          handleOfflineStatus(robotId);
        } else if (status === 'online') {
          handleOnlineStatus(robotId);
        }

        setStatus(prev => ({
          ...prev,
          robotsOnline: activeRobots.current.size,
        }));
      } catch (error) {
        console.error(`Error handling status message for robot ${robotId}:`, error);
      }
    },
    [handleOfflineStatus, handleOnlineStatus]
  );

  // Handle position updates from position synchronizer
  const handlePositionUpdate = useCallback((_update: any) => {
    // Position updates are already handled in updateRobotPose
    dataPointCounter.current++;
  }, []);

  // Handle telemetry updates
  const handleTelemetryUpdate = useCallback((_telemetryData: TelemetryData) => {
    // Process telemetry and create alerts if needed
    dataPointCounter.current++;
  }, []);

  // Handle alert notifications
  const handleAlertNotification = useCallback((_alert: any) => {
    alertCounter.current++;
    setStatus(prev => ({
      ...prev,
      alertsTriggered: alertCounter.current,
    }));
  }, []);

  // Clear all robot timers
  const clearRobotTimers = useCallback(() => {
    robotTimers.current.forEach(timer => {
      clearTimeout(timer);
    });
    robotTimers.current.clear();
  }, []);

  // Setup ROS topic subscriptions
  const setupROSSubscriptions = useCallback(() => {
    if (!enablePositionTracking && !enableTelemetry) {
      return;
    }

    // Subscribe to robot pose updates
    if (enablePositionTracking) {
      // Subscribe to TF messages for robot positions
      rosClient.subscribe('/tf', 'tf2_msgs/TFMessage', msg => {
        handleTFMessage(msg);
      });

      // Subscribe to individual robot pose topics
      robots.forEach(robot => {
        if (robot.id) {
          const poseTopic = `/${robot.id}/pose`;
          rosClient.subscribe(poseTopic, 'geometry_msgs/PoseStamped', msg => {
            handleRobotPoseMessage(robot.id, msg);
          });
        }
      });
    }

    // Subscribe to telemetry data
    if (enableTelemetry) {
      robots.forEach(robot => {
        if (robot.id) {
          const telemetryTopic = `/${robot.id}/telemetry`;
          rosClient.subscribe(telemetryTopic, 'robot_monitor/Telemetry', msg => {
            handleTelemetryMessage(robot.id, msg);
          });
        }
      });
    }

    // Subscribe to robot status
    robots.forEach(robot => {
      if (robot.id) {
        const statusTopic = `/${robot.id}/status`;
        rosClient.subscribe(statusTopic, 'robot_monitor/Status', msg => {
          handleRobotStatusMessage(robot.id, msg);
        });
      }
    });
  }, [
    robots,
    enablePositionTracking,
    enableTelemetry,
    rosClient,
    handleRobotPoseMessage,
    handleRobotStatusMessage,
    handleTFMessage,
    handleTelemetryMessage,
  ]);

  // Connect to ROS bridge
  const connect = useCallback(async () => {
    try {
      if (!rosClient.isConnected) {
        await rosClient.connect();
      }

      // Setup ROS subscriptions
      setupROSSubscriptions();

      setStatus(prev => ({
        ...prev,
        connected: true,
        lastUpdate: new Date(),
      }));

      console.log('Real-time integration connected successfully');
    } catch (error) {
      console.error('Failed to connect to ROS bridge:', error);
      setStatus(prev => ({
        ...prev,
        connected: false,
        errors: [
          ...prev.errors,
          `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ],
      }));
    }
  }, [
    rosClient, // Setup ROS subscriptions
    setupROSSubscriptions,
  ]);

  // Disconnect from ROS bridge
  const disconnect = useCallback(() => {
    try {
      rosClient.disconnect();
      clearRobotTimers();
      activeRobots.current.clear();

      setStatus(prev => ({
        ...prev,
        connected: false,
        robotsOnline: 0,
        lastUpdate: null,
      }));

      console.log('Real-time integration disconnected');
    } catch (error) {
      console.error('Error during disconnection:', error);
    }
  }, [rosClient, clearRobotTimers]);

  // Initialize real-time integration
  const initialize = useCallback(async () => {
    try {
      setStatus(prev => ({ ...prev, errors: [] }));

      // Request notification permissions
      if (enableAlerts) {
        await alertManager.requestNotificationPermissions();
      }

      // Setup default alert rules
      if (enableAlerts) {
        alertManager.setupDefaultRules();
      }

      // Add processing callbacks
      if (enableTelemetry) {
        telemetry.addProcessingCallback(handleTelemetryUpdate);
      }

      if (enablePositionTracking) {
        positionSynchronizer.onPositionUpdate(handlePositionUpdate);
      }

      // Add alert notification callback
      if (enableAlerts) {
        alertSystem.addNotificationCallback(handleAlertNotification);
      }

      setIsInitialized(true);

      // Auto-connect if enabled
      if (autoConnect) {
        await connect();
      }
    } catch (error) {
      console.error('Failed to initialize real-time integration:', error);
      setStatus(prev => ({
        ...prev,
        errors: [
          ...prev.errors,
          `Initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ],
      }));
    }
  }, [
    enableTelemetry,
    enablePositionTracking,
    enableAlerts,
    autoConnect,
    telemetry,
    positionSynchronizer,
    alertSystem,
    connect,
    handleAlertNotification,
    handlePositionUpdate,
    handleTelemetryUpdate,
  ]);

  // Get system statistics
  const getSystemStats = useCallback(() => {
    return {
      ...status,
      connected: rosClient.isConnected,
      connectionStats: {
        attempts: rosClient.connectionAttempts,
        lastConnected: rosClient.lastConnected,
      },
      telemetryStats: telemetry.getSystemStats(),
      alertStats: alertSystem.getAlertStats(),
    };
  }, [status, rosClient, telemetry, alertSystem]);

  // Send command to robot
  const sendRobotCommand = useCallback(
    async (robotId: string, command: string, _args?: any) => {
      try {
        if (!rosClient.isConnected) {
          throw new Error('Not connected to ROS bridge');
        }

        const commandTopic = `/${robotId}/command`;
        rosClient.publish(commandTopic, 'std_msgs/String', { data: command });

        console.log(`Command sent to robot ${robotId}: ${command}`);
        return true;
      } catch (error) {
        console.error(`Failed to send command to robot ${robotId}:`, error);
        return false;
      }
    },
    [rosClient]
  );

  // Initialize on mount
  useEffect(() => {
    if (!isInitialized) {
      initialize();
    }

    return () => {
      // Cleanup all resources
      disconnect();

      // Clear robot timers
      robotTimers.current.forEach(timer => {
        clearTimeout(timer);
      });
      robotTimers.current.clear();
      activeRobots.current.clear();

      // Reset counters
      dataPointCounter.current = 0;
      alertCounter.current = 0;
    };
  }, [initialize, disconnect, isInitialized]);

  // Update subscriptions when robots change
  useEffect(() => {
    if (rosClient.isConnected && isInitialized) {
      setupROSSubscriptions();
    }
  }, [rosClient.isConnected, isInitialized, setupROSSubscriptions]);

  return {
    // Connection management
    initialize,
    connect,
    disconnect,

    // Status
    status,
    isConnected: status.connected,
    robotsOnline: status.robotsOnline,

    // Actions
    sendRobotCommand,

    // Statistics
    getSystemStats,

    // Configuration
    config,
  };
}
