import { PERMISSIONS, type Permission } from '@tensrai/shared';
import type React from 'react';
import { useAuth } from '@/stores/auth';

interface PermissionGuardProps {
  permission: Permission;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

const PermissionGuard: React.FC<PermissionGuardProps> = ({
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

export const EmergencyStopGuard: React.FC<{
  children: React.ReactNode;
  fallback?: React.ReactNode;
}> = ({ children, fallback }) => (
  <PermissionGuard permission={PERMISSIONS.EMERGENCY_STOP} fallback={fallback}>
    {children}
  </PermissionGuard>
);
