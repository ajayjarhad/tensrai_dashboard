import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DockSummaryBar } from './DockSummaryBar';
import { LogsTab } from './LogsTab';
import type { MissionDockProps } from './missionDockModel';
import { OngoingTab } from './OngoingTab';
import { StartTab } from './StartTab';

export type { MissionLogView, OngoingMissionView } from './missionDockModel';

type DockTab = 'ongoing' | 'start' | 'logs';

function DockTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <Button type="button" size="sm" variant={active ? 'default' : 'outline'} onClick={onClick}>
      {children}
    </Button>
  );
}

export function MissionDock(props: MissionDockProps) {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<DockTab>('ongoing');
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());
  const ongoingCount = props.ongoingMissions.length;

  useEffect(() => {
    const shouldTick = expanded || ongoingCount > 0;
    if (!shouldTick) return;
    const timer = setInterval(() => setClockNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expanded, ongoingCount]);

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none p-2 md:p-3">
      <div className="pointer-events-auto rounded-xl border border-border bg-card/95 shadow-2xl backdrop-blur">
        <DockSummaryBar
          {...props}
          clockNowMs={clockNowMs}
          expanded={expanded}
          onToggleExpanded={() => setExpanded(value => !value)}
        />

        {expanded && (
          <div className="max-h-[45vh] overflow-y-auto">
            <div className="flex items-center gap-1 px-3 pt-3">
              <DockTabButton active={tab === 'ongoing'} onClick={() => setTab('ongoing')}>
                Ongoing
              </DockTabButton>
              <DockTabButton active={tab === 'start'} onClick={() => setTab('start')}>
                Start Mission
              </DockTabButton>
              <DockTabButton active={tab === 'logs'} onClick={() => setTab('logs')}>
                Logs
              </DockTabButton>
            </div>

            {tab === 'ongoing' && <OngoingTab {...props} clockNowMs={clockNowMs} />}
            {tab === 'start' && <StartTab {...props} />}
            {tab === 'logs' && <LogsTab missionLogs={props.missionLogs} />}
          </div>
        )}
      </div>
    </div>
  );
}
