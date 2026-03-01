import { AlertTriangle } from 'lucide-react';
import React from 'react';
import { EmergencyStopGuard } from '@/components/guards/PermissionGuard';
import { Button } from '@/components/ui/button';
import { cn, generateId } from '@/lib/utils/utils';
import type { EmergencyHeaderProps } from './types';

const EmergencyHeader = React.forwardRef<HTMLElement, EmergencyHeaderProps>(
  (
    {
      className,
      summary,
      pendingDispatch = false,
      canSendEmergency = false,
      canReleaseSoftware = false,
      onEmergencyAll,
      onReleaseSoftware,
      ...props
    },
    ref
  ) => {
    const headerId = generateId('header');
    const emergencyButtonId = generateId('emergency');
    const buttonShowsRelease = canReleaseSoftware;
    const buttonDisabled = buttonShowsRelease
      ? !canReleaseSoftware || pendingDispatch
      : !canSendEmergency || pendingDispatch;
    const buttonLabel = buttonShowsRelease ? 'Release' : 'Emergency';
    const handleClick = () => {
      if (buttonShowsRelease) {
        onReleaseSoftware?.();
        return;
      }
      onEmergencyAll?.();
    };

    return (
      <header
        id={headerId}
        ref={ref}
        className={cn(
          'flex items-center justify-between w-full h-16 px-6 md:px-8 gap-4',
          'border-b border-border bg-background',
          'shadow-sm shadow-black/5 sticky top-0 z-50',
          className
        )}
        {...props}
      >
        <div className="flex items-center space-x-3 min-w-0">
          <img src="/assets/logo.png" alt="Tensrai" className="h-8 w-8 object-contain" />
          <h1 className="text-2xl font-bold tracking-tight text-foreground font-sans">Tensrai</h1>
        </div>

        <EmergencyStopGuard>
          <Button
            id={emergencyButtonId}
            type="button"
            variant={buttonShowsRelease ? 'outline' : 'destructive'}
            size="lg"
            onClick={handleClick}
            disabled={buttonDisabled}
            className="h-11 px-5 font-bold tracking-wide justify-center safety-critical"
          >
            <AlertTriangle className="w-5 h-5 mr-2" />
            {buttonLabel}
          </Button>
        </EmergencyStopGuard>
      </header>
    );
  }
);

EmergencyHeader.displayName = 'EmergencyHeader';

export { EmergencyHeader };

export type { EmergencyHeaderProps };
