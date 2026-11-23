import type { MapRobot, MapSummary } from './api';

export const NEEDS_ATTENTION = new Set<MapRobot['state']>(['needs_sync', 'failed', 'conflict']);

export const mapsNeedingAttention = (maps: MapSummary[]) =>
  maps.filter(map => map.robots.some(robot => NEEDS_ATTENTION.has(robot.state)));

// "Sync all that need it" runs one job per robot, which sends every map that robot is behind on.
export const robotsBehind = (maps: MapSummary[]) => [
  ...new Set(
    maps.flatMap(map =>
      map.robots.filter(robot => robot.state === 'needs_sync').map(robot => robot.robotId)
    )
  ),
];

export const anySyncing = (maps: MapSummary[] | undefined) =>
  Boolean(maps?.some(map => map.robots.some(robot => robot.state === 'syncing')));

export const filterMaps = (maps: MapSummary[], search: string, robotId: string) => {
  const needle = search.trim().toLowerCase();
  return maps.filter(
    map =>
      (!needle ||
        map.name.toLowerCase().includes(needle) ||
        map.filename.toLowerCase().includes(needle)) &&
      (!robotId || map.robots.some(robot => robot.robotId === robotId))
  );
};

export const mapSize = (map: Pick<MapSummary, 'pixelWidth' | 'pixelHeight' | 'metadata'>) => {
  const { pixelWidth: width, pixelHeight: height } = map;
  if (!width || !height) return null;
  const resolution = map.metadata?.resolution;
  return {
    pixels: `${width} × ${height} px`,
    metres: resolution
      ? `${(width * resolution).toFixed(1)} × ${(height * resolution).toFixed(1)} m · ${resolution} m/px`
      : null,
  };
};

// Edited here (by whom), or else the latest copy a robot sent.
export const lastChange = (map: MapSummary) => {
  if (map.editedAt) return { at: map.editedAt, by: map.editedBy || 'Edited here' };
  const latest = map.robots
    .filter(robot => robot.syncedAt)
    .sort((a, b) => String(b.syncedAt).localeCompare(String(a.syncedAt)))[0];
  return latest?.syncedAt ? { at: latest.syncedAt, by: `Imported from ${latest.name}` } : null;
};

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

// "Today, 09:42", "Yesterday, 17:05", or "6 Nov, 14:20".
export const formatWhen = (iso: string, now = new Date()) => {
  const at = new Date(iso);
  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(at, now)) return `Today, ${time}`;
  if (sameDay(at, yesterday)) return `Yesterday, ${time}`;
  const day = at.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
  return `${day}, ${time}`;
};

const listed = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

// The banner's specifics: the first two problems by name, then how many more.
export const attentionSentence = (maps: MapSummary[]) => {
  const problems = maps.flatMap(map =>
    map.robots.flatMap(robot => {
      if (robot.state === 'needs_sync') return [`${robot.name} has an older ${map.name}`];
      if (robot.state === 'conflict') return [`${map.name} changed on ${robot.name}`];
      if (robot.state === 'failed') return [`${map.name} failed to reach ${robot.name}`];
      return [];
    })
  );
  const shown = problems.slice(0, 2);
  const more = problems.length - shown.length;
  const sentence = shown.join(', and ');
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}${more > 0 ? `, and ${more} more` : ''}.`;
};

// The filename a new map gets: the first free map<N>.yaml, as the server picks it.
export const nextMapFilename = (maps: Pick<MapSummary, 'filename'>[]) => {
  const taken = new Set(maps.map(map => map.filename));
  for (let n = 1; ; n += 1) if (!taken.has(`map${n}.yaml`)) return `map${n}.yaml`;
};

// The Assign dialog's footer: what Apply will do.
export const assignmentSummary = (added: string[], removed: string[]) => {
  if (added.length === 0 && removed.length === 0) return 'No changes yet.';
  const adds = added.length ? `Adds ${listed(added)}.` : '';
  const removes = removed.length ? `Removes ${listed(removed)}.` : 'Nothing is removed.';
  return [adds, removes].filter(Boolean).join(' ');
};
