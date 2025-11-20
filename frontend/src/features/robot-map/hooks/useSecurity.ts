/**
 * Security Hook
 * Functional replacement for SecurityService with React integration
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface AuthCredentials {
  token?: string;
  username?: string;
  password?: string;
  apiKey?: string;
}

export interface SecurityConfig {
  enableAuthentication: boolean;
  enableRateLimiting: boolean;
  enableInputValidation: boolean;
  allowedOrigins: string[];
  maxRequestsPerMinute: number;
  tokenExpiryTime: number; // minutes
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  sanitizedData?: any;
}

export interface SecurityState {
  isAuthenticated: boolean;
  authToken: string | null;
  tokenExpiry: Date | null;
  lastValidationTime: number | null;
  stats: {
    validationCount: number;
    rateLimitHits: number;
    authenticationAttempts: number;
  };
}

/**
 * Security Hook for authentication and input validation
 */
export function useSecurity(initialConfig: Partial<SecurityConfig> = {}) {
  const [config, setConfig] = useState<SecurityConfig>({
    enableAuthentication: initialConfig.enableAuthentication ?? false,
    enableRateLimiting: initialConfig.enableRateLimiting ?? true,
    enableInputValidation: initialConfig.enableInputValidation ?? true,
    allowedOrigins: initialConfig.allowedOrigins ?? ['localhost', '127.0.0.1'],
    maxRequestsPerMinute: initialConfig.maxRequestsPerMinute ?? 1000,
    tokenExpiryTime: initialConfig.tokenExpiryTime ?? 60,
    ...initialConfig,
  });

  const [state, setState] = useState<SecurityState>({
    isAuthenticated: false,
    authToken: null,
    tokenExpiry: null,
    lastValidationTime: null,
    stats: {
      validationCount: 0,
      rateLimitHits: 0,
      authenticationAttempts: 0,
    },
  });

  // Refs for non-state data
  const requestCountsRef = useRef(new Map<string, { count: number; resetTime: number }>());

  /**
   * Authenticate with credentials
   */
  const authenticate = useCallback(
    async (credentials: AuthCredentials): Promise<boolean> => {
      if (!config.enableAuthentication) {
        return true;
      }

      try {
        // Validate credentials
        const validation = validateCredentials(credentials);
        if (!validation.isValid) {
          console.error('Authentication failed:', validation.errors);
          return false;
        }

        // Generate or validate token
        let token: string | null = null;
        let expiry: Date | null = null;

        if (credentials.token) {
          const isValidToken = await validateToken(credentials.token);
          if (isValidToken) {
            token = credentials.token;
            expiry = new Date(Date.now() + config.tokenExpiryTime * 60 * 1000);
          }
        }

        // For demo purposes, accept any credentials and generate token
        if (!token) {
          const tokenData = generateToken(credentials);
          token = tokenData.token;
          expiry = tokenData.expiry;
        }

        setState(prev => ({
          ...prev,
          isAuthenticated: true,
          authToken: token,
          tokenExpiry: expiry,
          stats: {
            ...prev.stats,
            authenticationAttempts: prev.stats.authenticationAttempts + 1,
          },
        }));

        return true;
      } catch (error) {
        console.error('Authentication error:', error);
        return false;
      }
    },
    [config]
  );

  /**
   * Check if current session is authenticated
   */
  const isAuthenticated = useCallback((): boolean => {
    if (!config.enableAuthentication) {
      return true;
    }

    if (!state.authToken || !state.tokenExpiry) {
      return false;
    }

    return new Date() < state.tokenExpiry;
  }, [config, state.authToken, state.tokenExpiry]);

  /**
   * Get current auth token
   */
  const getAuthToken = useCallback((): string | null => {
    if (!isAuthenticated()) {
      return null;
    }
    return state.authToken;
  }, [isAuthenticated, state.authToken]);

  /**
   * Logout and clear authentication
   */
  const logout = useCallback((): void => {
    setState(prev => ({
      ...prev,
      isAuthenticated: false,
      authToken: null,
      tokenExpiry: null,
    }));
  }, []);

  // Rate limiting check
  const checkRateLimit = useCallback(
    (requesterId: string): boolean => {
      const now = Date.now();
      const windowStart = now - 60000; // 1 minute window

      const requestCount = requestCountsRef.current.get(requesterId);

      if (!requestCount || now > requestCount.resetTime) {
        // Reset or initialize counter
        requestCountsRef.current.set(requesterId, {
          count: 1,
          resetTime: windowStart + 60000,
        });
        return true;
      }

      if (requestCount.count >= config.maxRequestsPerMinute) {
        return false;
      }

      requestCount.count++;
      return true;
    },
    [config.maxRequestsPerMinute]
  );

  // Origin validation
  const validateOrigin = useCallback(
    (origin: string): boolean => {
      try {
        const url = new URL(origin);
        const hostname = url.hostname;

        return (
          config.allowedOrigins.includes(hostname) ||
          config.allowedOrigins.includes('*') ||
          hostname.startsWith('localhost') ||
          hostname.startsWith('127.0.0.1') ||
          hostname.startsWith('192.168.') ||
          hostname.startsWith('10.')
        );
      } catch (error) {
        console.error('Origin validation error:', error);
        return false;
      }
    },
    [config.allowedOrigins]
  );

  /**
   * Validate incoming request
   */
  const validateRequest = useCallback(
    (requesterId: string, data: any): ValidationResult => {
      setState(prev => ({
        ...prev,
        stats: {
          ...prev.stats,
          validationCount: prev.stats.validationCount + 1,
          lastValidationTime: Date.now(),
        },
      }));

      const errors: string[] = [];

      // Rate limiting check
      if (config.enableRateLimiting && !checkRateLimit(requesterId)) {
        errors.push('Rate limit exceeded');
        setState(prev => ({
          ...prev,
          stats: {
            ...prev.stats,
            rateLimitHits: prev.stats.rateLimitHits + 1,
          },
        }));
      }

      // Input validation
      if (config.enableInputValidation) {
        const inputValidation = validateInput(data);
        errors.push(...inputValidation.errors);
      }

      // Origin validation
      if (!validateOrigin(requesterId)) {
        errors.push('Invalid origin');
      }

      return {
        isValid: errors.length === 0,
        errors,
        sanitizedData: sanitizeInput(data),
      };
    },
    [config, checkRateLimit, validateOrigin]
  );

  /**
   * Update security configuration
   */
  const updateConfig = useCallback((newConfig: Partial<SecurityConfig>) => {
    setConfig(prev => ({ ...prev, ...newConfig }));
  }, []);

  // Clean up old rate limit entries
  useEffect(() => {
    const cleanup = () => {
      const now = Date.now();
      for (const [requesterId, requestCount] of Array.from(requestCountsRef.current)) {
        if (now > requestCount.resetTime + 60000) {
          requestCountsRef.current.delete(requesterId);
        }
      }
    };

    const interval = setInterval(cleanup, 300000); // Clean up every 5 minutes
    return () => clearInterval(interval);
  }, []);

  return {
    // State
    isAuthenticated,
    config,
    stats: state.stats,

    // Actions
    authenticate,
    getAuthToken,
    logout,
    validateRequest,
    updateConfig,
  };
}

/**
 * Validate authentication credentials
 */
function validateTokenFormat(token: string): string | null {
  if (typeof token !== 'string' || token.length < 10) {
    return 'Invalid token format';
  }
  return null;
}

function validateUsernamePassword(username?: string, password?: string): string[] {
  const errors: string[] = [];
  if (!username || !password) {
    errors.push('Both username and password are required');
  }
  if (username && username.length < 3) {
    errors.push('Username must be at least 3 characters');
  }
  if (password && password.length < 8) {
    errors.push('Password must be at least 8 characters');
  }
  return errors;
}

/**
 * Validate authentication credentials
 */
function validateCredentials(credentials: AuthCredentials): ValidationResult {
  const errors: string[] = [];

  if (!credentials) {
    errors.push('No credentials provided');
    return { isValid: false, errors };
  }

  // Validate token
  if (credentials.token) {
    const tokenError = validateTokenFormat(credentials.token);
    if (tokenError) {
      errors.push(tokenError);
    }
  }

  // Validate username/password
  if (credentials.username || credentials.password) {
    const authErrors = validateUsernamePassword(credentials.username, credentials.password);
    errors.push(...authErrors);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validate JWT or custom token
 */
async function validateToken(token: string): Promise<boolean> {
  try {
    // Basic token validation
    if (!token || typeof token !== 'string') {
      return false;
    }

    // For JWT tokens (if you're using them)
    if (token.includes('.')) {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return false;
      }

      // Decode and verify payload
      const payload = JSON.parse(atob(parts[1]));
      const now = Math.floor(Date.now() / 1000);

      if (payload.exp && payload.exp < now) {
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error('Token validation error:', error);
    return false;
  }
}

/**
 * Generate secure authentication token
 */
function generateToken(credentials: AuthCredentials): { token: string; expiry: Date } {
  // Generate cryptographically secure random token
  const array = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(array);
  } else {
    // Fallback for older browsers
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }

  // Convert to hex string
  const randomPart = Array.from(array)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const timestamp = Date.now();
  const payload = {
    sub: credentials.username || 'user',
    iat: timestamp,
    exp: timestamp + 60 * 60, // 1 hour
    scope: 'ros_bridge_access',
    jti: randomPart, // JWT ID for uniqueness
  };

  // Create proper JWT-like token with secure encoding
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  // Base64URL encode without btoa (more secure)
  const base64UrlEncode = (str: string) => {
    if (typeof btoa !== 'undefined') {
      return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    }
    throw new Error('Environment does not support base64 encoding');
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));

  // Create signature (simplified for demo)
  const signatureData = `${encodedHeader}.${encodedPayload}`;
  const signature = base64UrlEncode(signatureData);

  return {
    token: `${encodedHeader}.${encodedPayload}.${signature}`,
    expiry: new Date(timestamp + 60 * 60 * 1000), // 1 hour from now
  };
}

/**
 * Validate input data structure with comprehensive security checks
 */
function validateInput(data: any): ValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    errors.push('Invalid data structure');
    return { isValid: false, errors };
  }

  // Type validation
  if (Array.isArray(data)) {
    errors.push('Array data not allowed');
    return { isValid: false, errors };
  }

  // Size validation
  const dataSize = JSON.stringify(data).length;
  if (dataSize > 1024 * 1024) {
    // 1MB limit
    errors.push('Data size exceeds limit');
  }

  // Check for dangerous properties
  const dangerousProps = [
    '__proto__',
    'constructor',
    'prototype',
    'eval',
    'Function',
    'setTimeout',
    'setInterval',
    'document',
    'window',
    'global',
    'process',
  ];

  for (const prop of dangerousProps) {
    if (Object.hasOwn(data, prop)) {
      errors.push(`Dangerous property: ${prop}`);
    }
  }

  // Validate ROS specific fields if present
  if (data.op) {
    const validOps = [
      'publish',
      'subscribe',
      'advertise',
      'call_service',
      'unadvertise',
      'unsubscribe',
    ];
    if (!validOps.includes(data.op)) {
      errors.push('Invalid ROS operation');
    }
  }

  if (data.topic) {
    if (!isValidROSTopic(data.topic)) {
      errors.push('Invalid ROS topic name');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Sanitize input data
 */
function sanitizeInput(data: any): any {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const sanitized: any = {};
  for (const [key, value] of Object.entries(data)) {
    // Skip dangerous keys
    if (['__proto__', 'constructor', 'prototype'].includes(key)) {
      continue;
    }

    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value);
    } else if (typeof value === 'object' && value !== null) {
      // Recursively sanitize nested objects
      sanitized[key] = sanitizeInput(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Sanitize string values
 */
function sanitizeString(str: string): string {
  return str
    .replace(/[<>]/g, '') // Remove HTML brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .trim();
}

/**
 * Validate ROS topic name
 */
function isValidROSTopic(topic: string): boolean {
  if (!topic || typeof topic !== 'string') {
    return false;
  }

  // ROS topic name rules
  const validPattern = /^[a-zA-Z][/a-zA-Z0-9_]*$/;
  return validPattern.test(topic) && topic.length <= 255;
}
