import { AlertTriangle } from 'lucide-react';
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn, generateId } from '@/lib/utils/utils';
import type { EmergencyHeaderProps } from './types';

const EmergencyHeader = React.forwardRef<HTMLElement, EmergencyHeaderProps>(
  ({ className, ...props }, ref) => {
    const headerId = generateId('header');
    const emergencyButtonId = generateId('emergency');
    const [isEngaged, setIsEngaged] = useState(false);

    const handleButtonClick = () => {
      setIsEngaged(!isEngaged);
    };

    return (
      <header
        id={headerId}
        ref={ref}
        className={cn(
          'flex items-center justify-between w-full h-16 px-6 md:px-8',
          'border-b border-border bg-background',
          'shadow-sm shadow-black/5',
          'sticky top-0 z-50',
          className
        )}
        {...props}
      >
        <div className="flex items-center space-x-3">
          <img src="/assets/logo.png" alt="Tensrai" className="h-8 w-8 object-contain" />
          <h1 className="text-2xl font-bold tracking-tight text-foreground font-sans">Tensrai</h1>
        </div>

        <div className="flex items-center space-x-4">
          <Button
            id={emergencyButtonId}
            variant="destructive"
            size="lg"
            onClick={handleButtonClick}
            className="w-44 h-12 px-6 font-bold text-lg uppercase tracking-wide justify-center safety-critical"
          >
            <AlertTriangle className="w-5 h-5 mr-2" />
            {isEngaged ? 'Release' : 'Emergency'}
          </Button>
        </div>
      </header>
    );
  }
);

EmergencyHeader.displayName = 'EmergencyHeader';

export { EmergencyHeader };

export type { EmergencyHeaderProps };
