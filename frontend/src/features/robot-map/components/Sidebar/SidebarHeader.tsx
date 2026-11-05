import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

interface SidebarHeaderProps {
  isOpen: boolean;
  onToggle: () => void;
  title?: string;
}

export function SidebarHeader({ isOpen, onToggle, title = 'Robots' }: SidebarHeaderProps) {
  const orgName = useAuthStore(state => state.user?.orgName);

  return (
    <div className="flex items-center justify-between p-4 border-b border-border/60 min-w-[20rem]">
      <div className={cn('transition-opacity duration-200', !isOpen && 'opacity-0 hidden')}>
        <h2 className="font-semibold text-foreground whitespace-nowrap">{title}</h2>
        {orgName && <p className="text-xs text-muted-foreground whitespace-nowrap">{orgName}</p>}
      </div>
      <button
        type="button"
        onClick={onToggle}
        className="p-1 hover:bg-muted rounded-md transition-colors"
        title={isOpen ? 'Collapse Sidebar' : 'Expand Sidebar'}
      >
        {isOpen ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
      </button>
    </div>
  );
}
