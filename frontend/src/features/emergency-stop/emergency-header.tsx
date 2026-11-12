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
      pendingDesiredStatus = null,
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
          <h1
            className={cn(
              'text-2xl font-bold tracking-tight text-foreground font-sans',
              canReleaseSoftware && 'hidden sm:block'
            )}
          >
            Tensrai
          </h1>
        </div>

        <EmergencyStopGuard>
          {/* Release sits on the inside so Emergency doesn't move when it appears. */}
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {canReleaseSoftware && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={onReleaseSoftware}
                disabled={pendingDesiredStatus !== null}
                className="h-11 px-3 sm:px-5 font-bold tracking-wide justify-center safety-critical"
              >
                Release
              </Button>
            )}
            {/* Only a stop already on its way holds this back: a release waiting on a slow robot's
                ack must not delay a stop. */}
            <Button
              id={emergencyButtonId}
              type="button"
              variant="destructive"
              size="lg"
              onClick={onEmergencyAll}
              disabled={!canSendEmergency || pendingDesiredStatus === true}
              className="h-11 px-3 sm:px-5 font-bold tracking-wide justify-center safety-critical"
            >
              <AlertTriangle className="w-5 h-5 mr-2" />
              Emergency
            </Button>
          </div>
        </EmergencyStopGuard>
      </header>
    );
  }
);

EmergencyHeader.displayName = 'EmergencyHeader';

export { EmergencyHeader };

export type { EmergencyHeaderProps };
