import { useNavigate } from '@tanstack/react-router';
import { Battery, ChevronLeft, ChevronRight, LogOut, MapPin, MoreVertical, Users, Cpu } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/stores/auth';
import { cn } from '../../../lib/utils';
import type { Robot } from '../../../types/robot';

interface RobotSidebarProps {
  robots: Robot[];
  selectedRobotId: string | null;
  onSelectRobot: (robot: Robot | null) => void;
  isOpen: boolean;
  onToggle: () => void;
  className?: string;
}

export function RobotSidebar({
  robots,
  selectedRobotId,
  onSelectRobot,
  isOpen,
  onToggle,
  className,
}: RobotSidebarProps) {
  const navigate = useNavigate();
  const { user, isAdmin, logout } = useAuth();
  const isUserAdmin = typeof isAdmin === 'function' ? isAdmin() : Boolean(isAdmin);
  const selectedRobot = robots.find(r => r.id === selectedRobotId);
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div
      className={cn(
        'relative flex flex-col h-full bg-card border-l border-border shadow-xl transition-all duration-300 ease-in-out overflow-hidden',
        className
      )}
      style={{ width: isOpen ? '20rem' : '4rem' }}
    >
      <div className="flex items-center justify-between p-4 border-b border-border/60 min-w-[20rem]">
        <h2
          className={cn(
            'font-semibold text-foreground transition-opacity duration-200 whitespace-nowrap',
            !isOpen && 'opacity-0 hidden'
          )}
        >
          Robots
        </h2>
        <button
          type="button"
          onClick={onToggle}
          className="p-1 hover:bg-muted rounded-md transition-colors"
          title={isOpen ? 'Collapse Sidebar' : 'Expand Sidebar'}
        >
          {isOpen ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {/* Collapsed View - Icons Only */}
        {!isOpen && (
          <div className="flex flex-col items-center py-4 space-y-4 w-16 mx-auto">
            {robots.map(robot => (
              <button
                type="button"
                key={robot.id}
                onClick={() => {
                  if (!isOpen) onToggle();
                  onSelectRobot(robot);
                }}
                className={cn(
                  'w-10 h-10 flex items-center justify-center rounded-full transition-colors relative',
                  selectedRobotId === robot.id
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-muted text-muted-foreground'
                )}
                title={robot.name}
              >
                <div
                  className={cn(
                    'absolute top-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white',
                    robot.status === 'MISSION'
                      ? 'bg-status-active'
                      : robot.status.includes('EMERGENCY')
                        ? 'bg-status-error'
                        : 'bg-status-offline'
                  )}
                />
                <span className="text-xs font-bold">{robot.name.substring(0, 2)}</span>
              </button>
            ))}
          </div>
        )}

        {/* Expanded View */}
        {isOpen &&
          (selectedRobot ? (
            <div className="p-4 space-y-6 min-w-[20rem]">
              <button
                type="button"
                onClick={() => onSelectRobot(null)}
                className="flex items-center text-sm mb-4"
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                Back to List
              </button>

              <div className="space-y-4">
                <div>
                  <h3 className="text-2xl font-bold text-foreground">{selectedRobot.name}</h3>
                  <div className="flex items-center mt-2 space-x-2">
                    <span
                      className={cn(
                        'px-2 py-1 text-xs font-medium rounded-full',
                        selectedRobot.status === 'MISSION'
                          ? 'bg-status-active/15 text-status-active'
                          : selectedRobot.status.includes('EMERGENCY')
                            ? 'bg-status-error/15 text-status-error'
                            : 'bg-status-offline/20 text-status-offline'
                      )}
                    >
                      {selectedRobot.status}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Last seen: {new Date(selectedRobot.lastSeen).toLocaleTimeString()}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-muted rounded-lg">
                    <div className="flex items-center text-muted-foreground mb-1">
                      <Battery className="w-4 h-4 mr-2" />
                      <span className="text-xs font-medium">Battery</span>
                    </div>
                    <span className="text-lg font-semibold">
                      {selectedRobot.battery !== undefined ? `${selectedRobot.battery}%` : '--'}
                    </span>
                  </div>
                  <div className="p-3 bg-muted rounded-lg">
                    <div className="flex items-center text-muted-foreground mb-1">
                      <MapPin className="w-4 h-4 mr-2" />
                      <span className="text-xs font-medium">Map</span>
                    </div>
                    <span className="text-lg font-semibold uppercase">
                      {selectedRobot.name || '--'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border/60 min-w-[20rem]">
              {robots.map(robot => (
                <button
                  key={robot.id}
                  type="button"
                  onClick={() => onSelectRobot(robot)}
                  className={cn(
                    'w-full text-left p-4 hover:bg-muted transition-colors focus:outline-none focus:bg-muted',
                    selectedRobotId === robot.id && 'bg-primary/10 hover:bg-primary/10'
                  )}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-medium text-foreground">{robot.name}</span>
                    <span
                      className={cn(
                        'w-2 h-2 rounded-full mt-2',
                        robot.status === 'MISSION'
                          ? 'bg-status-active'
                          : robot.status.includes('EMERGENCY')
                            ? 'bg-status-error'
                            : 'bg-status-offline'
                      )}
                    />
                  </div>
                  <div className="flex justify-between items-center text-xs text-muted-foreground">
                    <span>{robot.status}</span>
                    <span>{robot.battery !== undefined ? `${robot.battery}%` : ''}</span>
                  </div>
                </button>
              ))}
            </div>
          ))}
      </div>

      <div className="p-4 border-t border-border bg-card">
        {isOpen ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-foreground/80 text-sm font-semibold">
                {user?.displayName?.slice(0, 1)?.toUpperCase() || 'U'}
              </div>
              <div>
                <div className="text-sm font-medium text-foreground">
                  {user?.displayName || user?.username || 'User'}
                </div>
                <div className="text-xs text-muted-foreground">{user?.role || 'USER'}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isUserAdmin && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowMenu(prev => !prev)}
                    className="p-2 rounded-md hover:bg-muted transition-colors"
                    title="Admin settings"
                    aria-label="Admin settings"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                  {showMenu && (
                    <div className="absolute right-0 mt-2 w-44 rounded-md bg-card border border-border shadow-lg z-20">
                      <button
                        type="button"
                        onClick={() => {
                          setShowMenu(false);
                          navigate({ to: '/admin/users' });
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors"
                      >
                        <Users className="h-4 w-4" />
                        Manage Users
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowMenu(false);
                          navigate({ to: '/admin/robots' });
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors"
                      >
                        <Cpu className="h-4 w-4" />
                        Manage Robots
                      </button>
                    </div>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={logout}
                className="p-2 rounded-md hover:bg-muted transition-colors"
                title="Log out"
                aria-label="Log out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-foreground/80 text-sm font-semibold">
              {user?.displayName?.slice(0, 1)?.toUpperCase() || 'U'}
            </div>
              <div className="flex flex-col items-center gap-2">
                {isUserAdmin && (
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (!isOpen) onToggle();
                        navigate({ to: '/admin/users' });
                      }}
                      className="p-2 rounded-md hover:bg-muted transition-colors"
                      title="Manage users"
                      aria-label="Manage users"
                    >
                      <Users className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!isOpen) onToggle();
                        navigate({ to: '/admin/robots' });
                      }}
                      className="p-2 rounded-md hover:bg-muted transition-colors"
                      title="Manage robots"
                      aria-label="Manage robots"
                    >
                      <Cpu className="h-4 w-4" />
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={logout}
                  className="p-2 rounded-md hover:bg-muted transition-colors"
                title="Log out"
                aria-label="Log out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
