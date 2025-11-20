/**
 * ROS Client Hook
 * Provides a functional interface for ROS bridge connectivity
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface RobotTelemetryData {
  robotId: string;
  timestamp: Date;
  position: {
    x: number;
    y: number;
    z: number;
  };
  orientation: {
    x: number;
    y: number;
    z: number;
    w: number;
  };
  battery?: {
    level: number;
    voltage: number;
  };
  status: 'active' | 'idle' | 'error' | 'offline';
  speed?: {
    linear: number;
    angular: number;
  };
}

export interface ROSClientConfig {
  url: string;
  reconnectAttempts?: number;
  connectionTimeout?: number;
  enableAuthentication?: boolean;
}

export interface ROSClientState {
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  lastConnected: number | null;
  connectionAttempts: number;
}

export interface ROSClientMethods {
  connect: () => Promise<void>;
  disconnect: () => void;
  subscribe: (topic: string, messageType: string, callback: (data: any) => void) => () => void;
  unsubscribe: (topic: string) => void;
  publish: (topic: string, messageType: string, data: any) => void;
  callService: (serviceName: string, serviceType: string, data: any) => Promise<any>;
}

/**
 * Simple ROS client hook for WebSocket-based ROS bridge communication
 * This is a functional replacement for the class-based ROSBridgeClient
 */
export function useROSClient(config: ROSClientConfig): ROSClientState & ROSClientMethods {
  const [state, setState] = useState<ROSClientState>({
    isConnected: false,
    isConnecting: false,
    error: null,
    lastConnected: null,
    connectionAttempts: 0,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const subscriptionsRef = useRef<
    Map<string, { callback: (data: any) => void; messageType: string }>
  >(new Map());

  const connect = useCallback(async () => {
    if (state.isConnected || state.isConnecting) {
      return;
    }

    setState(prev => ({ ...prev, isConnecting: true, error: null }));

    try {
      const ws = new WebSocket(config.url);
      wsRef.current = ws;

      ws.onopen = () => {
        setState(prev => ({
          ...prev,
          isConnected: true,
          isConnecting: false,
          error: null,
          lastConnected: Date.now(),
          connectionAttempts: prev.connectionAttempts + 1,
        }));
      };

      ws.onclose = () => {
        setState(prev => ({
          ...prev,
          isConnected: false,
          isConnecting: false,
        }));
        wsRef.current = null;
      };

      ws.onerror = (_event: Event) => {
        setState(prev => ({
          ...prev,
          isConnecting: false,
          error: 'WebSocket connection error',
        }));
      };

      ws.onmessage = event => {
        try {
          const message = JSON.parse(event.data);

          // Handle subscription messages
          if (message.topic && message.op === 'publish') {
            const subscription = subscriptionsRef.current.get(message.topic);
            if (subscription) {
              subscription.callback(message.msg);
            }
          }
        } catch (error) {
          console.error('Failed to parse ROS message:', error);
        }
      };
    } catch (error) {
      setState(prev => ({
        ...prev,
        isConnecting: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      }));
    }
  }, [config.url, state.isConnected, state.isConnecting]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    subscriptionsRef.current.clear();
    setState(prev => ({
      ...prev,
      isConnected: false,
      isConnecting: false,
    }));
  }, []);

  const subscribe = useCallback(
    (topic: string, messageType: string, callback: (data: any) => void) => {
      // Store subscription
      subscriptionsRef.current.set(topic, { callback, messageType });

      // Send subscription message to ROS bridge
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            op: 'subscribe',
            topic,
            type: messageType,
          })
        );
      }

      // Return unsubscribe function
      return () => {
        subscriptionsRef.current.delete(topic);
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              op: 'unsubscribe',
              topic,
            })
          );
        }
      };
    },
    []
  );

  const unsubscribe = useCallback((topic: string) => {
    subscriptionsRef.current.delete(topic);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          op: 'unsubscribe',
          topic,
        })
      );
    }
  }, []);

  const publish = useCallback((topic: string, messageType: string, data: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          op: 'publish',
          topic,
          type: messageType,
          msg: data,
        })
      );
    }
  }, []);

  const callService = useCallback(
    async (serviceName: string, serviceType: string, data: any): Promise<any> => {
      return new Promise((resolve, reject) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          reject(new Error('Not connected to ROS bridge'));
          return;
        }

        const id = `service_${Date.now()}_${Math.random()}`;

        // Set up temporary message handler for service response
        const handleMessage = (event: MessageEvent) => {
          try {
            const message = JSON.parse(event.data);
            if (message.op === 'service_response' && message.id === id) {
              wsRef.current?.removeEventListener('message', handleMessage);
              if (message.result) {
                resolve(message.values);
              } else {
                reject(new Error(message.message || 'Service call failed'));
              }
            }
          } catch (error) {
            reject(error);
          }
        };

        wsRef.current.addEventListener('message', handleMessage);

        // Send service call request
        wsRef.current.send(
          JSON.stringify({
            op: 'call_service',
            id,
            service: serviceName,
            type: serviceType,
            args: data,
          })
        );

        // Timeout after 10 seconds
        setTimeout(() => {
          wsRef.current?.removeEventListener('message', handleMessage);
          reject(new Error('Service call timeout'));
        }, 10000);
      });
    },
    []
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    ...state,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    publish,
    callService,
  };
}
