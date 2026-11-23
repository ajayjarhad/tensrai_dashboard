import { Link } from '@tanstack/react-router';
import { Cpu, type LucideIcon, MoreHorizontal, Pencil, PenLine, Send, Trash2 } from 'lucide-react';
import { type ReactNode, useRef } from 'react';
import { useDetailsDismiss } from '@/hooks/useDetailsDismiss';
import { resolveApiHttpBase } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { MapRobot, MapSummary } from './api';
import { formatWhen, lastChange, mapSize } from './mapList';
import { SyncChip } from './SyncChip';

// The Maps page's rows: a table row on wider screens, a card on a phone, sharing their menus.

export type OpenDialog =
  | { kind: 'upload' }
  | { kind: 'import' }
  | { kind: 'assign'; mapId: string }
  | { kind: 'rename'; mapId: string }
  | { kind: 'conflict'; mapId: string; robotId: string }
  | null;

export type Can = { edit: boolean; sync: boolean; remove: boolean };

export interface RowProps {
  map: MapSummary;
  can: Can;
  onOpen: (dialog: OpenDialog) => void;
  onSync: (map: MapSummary) => void;
  onDelete: (map: MapSummary) => void;
  onChipAction: (map: MapSummary, robot: MapRobot) => void;
}

export function Menu({
  label,
  trigger,
  children,
}: {
  label: string;
  trigger: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useDetailsDismiss(ref);
  return (
    <details ref={ref} className="relative">
      <summary
        aria-label={label}
        title={label}
        className="list-none [&::-webkit-details-marker]:hidden"
      >
        {trigger}
      </summary>
      <div
        role="menu"
        className="absolute right-0 top-[calc(100%+8px)] z-20 grid min-w-[232px] gap-0.5 rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-md"
      >
        {children}
      </div>
    </details>
  );
}

export function MenuItem({
  icon: Icon,
  label,
  hint,
  danger,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string | undefined;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={cn(
        'flex items-start gap-2.5 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted focus-ring-strong',
        danger && 'text-status-error-ink'
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </button>
  );
}

export function Thumbnail({ map }: { map: MapSummary }) {
  const rev = encodeURIComponent(map.revision ?? map.contentHash ?? '');
  return (
    <img
      src={`${resolveApiHttpBase()}/maps/${map.id}/preview/webp?rev=${rev}`}
      alt=""
      width={56}
      height={56}
      loading="lazy"
      onError={event => {
        event.currentTarget.style.visibility = 'hidden';
      }}
      className="h-14 w-14 shrink-0 rounded-md border border-border bg-muted object-contain"
    />
  );
}

function RowMenu({
  map,
  can,
  onOpen,
  onSync,
  onDelete,
  trigger,
}: Omit<RowProps, 'onChipAction'> & { trigger: ReactNode }) {
  if (!can.edit && !can.sync && !can.remove) return null;
  const canSyncAll = map.robots.some(robot => robot.state === 'needs_sync');
  return (
    <Menu label={`More actions for ${map.name}`} trigger={trigger}>
      {can.edit && (
        <MenuItem
          icon={PenLine}
          label="Rename"
          onSelect={() => onOpen({ kind: 'rename', mapId: map.id })}
        />
      )}
      {can.sync && canSyncAll && (
        <MenuItem
          icon={Send}
          label="Sync to its robots"
          hint="Send the latest version to every robot behind"
          onSelect={() => void onSync(map)}
        />
      )}
      {can.remove && (
        <MenuItem
          icon={Trash2}
          label="Delete"
          hint={map.robots.length > 0 ? 'Remove it from its robots first' : undefined}
          danger
          onSelect={() => onDelete(map)}
        />
      )}
    </Menu>
  );
}

function Chips({ map, can, onChipAction }: Pick<RowProps, 'map' | 'can' | 'onChipAction'>) {
  return (
    <div className="flex max-w-[420px] flex-wrap gap-1.5">
      {map.robots.length === 0 ? (
        <span className="text-xs text-muted-foreground">Not on any robot</span>
      ) : (
        map.robots.map(robot => (
          <SyncChip
            key={robot.robotId}
            robot={robot}
            onAction={can.sync ? next => onChipAction(map, next) : undefined}
          />
        ))
      )}
    </div>
  );
}

const linkAction = 'inline-flex items-center gap-1 text-sm font-medium text-link focus-ring-strong';

export function MapRow(props: RowProps) {
  const { map, can, onOpen } = props;
  const size = mapSize(map);
  const change = lastChange(map);
  return (
    <tr className="border-t border-border align-top">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Thumbnail map={map} />
          <div className="min-w-0">
            {can.edit ? (
              <Link
                to="/maps/$mapId/edit"
                params={{ mapId: map.id }}
                className="font-medium hover:underline focus-ring-strong"
              >
                {map.name}
              </Link>
            ) : (
              <div className="font-medium">{map.name}</div>
            )}
            <div className="font-mono text-xs text-muted-foreground">{map.filename}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <div>{size?.pixels ?? '—'}</div>
        {size?.metres && <div className="text-xs text-muted-foreground">{size.metres}</div>}
      </td>
      <td className="px-4 py-3">
        <Chips {...props} />
      </td>
      <td className="px-4 py-3">
        {change ? (
          <>
            <div>{formatWhen(change.at)}</div>
            <div className="text-xs text-muted-foreground">{change.by}</div>
          </>
        ) : (
          '—'
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-3">
          {can.edit && (
            <Link to="/maps/$mapId/edit" params={{ mapId: map.id }} className={linkAction}>
              <Pencil className="h-4 w-4" aria-hidden />
              Edit
            </Link>
          )}
          {can.sync && (
            <button
              type="button"
              onClick={() => onOpen({ kind: 'assign', mapId: map.id })}
              className={linkAction}
            >
              <Cpu className="h-4 w-4" aria-hidden />
              Assign
            </button>
          )}
          <RowMenu
            {...props}
            trigger={
              <span className="inline-grid cursor-pointer place-items-center rounded-md p-2 text-foreground/80 hover:bg-muted hover:text-foreground focus-ring-strong">
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </span>
            }
          />
        </div>
      </td>
    </tr>
  );
}

const outlineButton =
  'inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input-strong bg-background px-3 text-sm font-medium hover:bg-muted focus-ring-strong';

// On a phone: what a map is, who has it, and the actions that work there (no editing).
export function MapCard(props: RowProps) {
  const { map, can, onOpen } = props;
  const size = mapSize(map);
  return (
    <article className="grid gap-3 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-3">
        <Thumbnail map={map} />
        <div className="min-w-0">
          <div className="truncate font-medium">{map.name}</div>
          <div className="text-xs text-muted-foreground">
            <span className="font-mono">{map.filename}</span>
            {size?.metres ? ` · ${size.metres.split(' · ')[0]}` : ''}
          </div>
        </div>
      </div>
      <Chips {...props} />
      <div className="flex items-center gap-2">
        {can.sync && (
          <button
            type="button"
            onClick={() => onOpen({ kind: 'assign', mapId: map.id })}
            className={outlineButton}
          >
            <Cpu className="h-4 w-4" aria-hidden />
            Assign
          </button>
        )}
        <RowMenu
          {...props}
          trigger={
            <span className={cn(outlineButton, 'w-9 justify-center px-0')}>
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </span>
          }
        />
      </div>
    </article>
  );
}
