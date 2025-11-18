import { PERMISSIONS, type Permission } from '@tensrai/shared';
import type React from 'react';
import { useAuth } from '@/stores/auth';

interface PermissionGuardProps {
  permission: Permission;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export const PermissionGuard: React.FC<PermissionGuardProps> = ({
  permission,
  children,
  fallback = null,
}) => {
  const { hasPermission, isLoading } = useAuth();

  // Show loading state while checking permissions
  if (isLoading) {
    return (
      <div className="animate-pulse">
        <div className="h-4 bg-muted rounded w-20 mb-2" />
        <div className="h-3 bg-muted rounded w-32" />
      </div>
    );
  }

  if (!hasPermission(permission)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};

// Convenience components for common permissions
export const AdminGuard: React.FC<{
  children: React.ReactNode;
  fallback?: React.ReactNode;
}> = ({ children, fallback }) => (
  <PermissionGuard permission={PERMISSIONS.USER_MANAGEMENT} fallback={fallback}>
    {children}
  </PermissionGuard>
);

export const DashboardViewGuard: React.FC<{
  children: React.ReactNode;
  fallback?: React.ReactNode;
}> = ({ children, fallback }) => (
  <PermissionGuard permission={PERMISSIONS.DASHBOARD_VIEW} fallback={fallback}>
    {children}
  </PermissionGuard>
);

export const RobotStatusGuard: React.FC<{
  children: React.ReactNode;
  fallback?: React.ReactNode;
}> = ({ children, fallback }) => (
  <PermissionGuard permission={PERMISSIONS.ROBOT_STATUS_READ} fallback={fallback}>
    {children}
  </PermissionGuard>
);

export const RobotControlGuard: React.FC<{
  children: React.ReactNode;
  fallback?: React.ReactNode;
}> = ({ children, fallback }) => (
  <PermissionGuard permission={PERMISSIONS.ROBOT_CONTROL} fallback={fallback}>
    {children}
  </PermissionGuard>
);

export const EmergencyStopGuard: React.FC<{
  children: React.ReactNode;
  fallback?: React.ReactNode;
}> = ({ children, fallback }) => (
  <PermissionGuard permission={PERMISSIONS.EMERGENCY_STOP} fallback={fallback}>
    {children}
  </PermissionGuard>
);

// Hook for programmatic permission checking
export const usePermissionGuard = (permission: Permission) => {
  const { hasPermission, isLoading, user } = useAuth();

  return {
    hasPermission: hasPermission(permission),
    isLoading,
    user,
  };
};
