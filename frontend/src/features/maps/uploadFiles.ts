// What the Upload dialog says about each file before anything is sent. A light read: the server
// checks everything again.

export interface FileCheck {
  ok: boolean;
  text: string;
}

const kilobytes = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

export const readPgmHeader = (head: string) => {
  const match = head.match(/^P5\s+(?:#[^\n]*\n\s*)*(\d+)\s+(\d+)\s+(\d+)\s/);
  return match
    ? { width: Number(match[1]), height: Number(match[2]), maxVal: Number(match[3]) }
    : null;
};

export const readMapYaml = (text: string) => {
  const resolution = Number(text.match(/^resolution:\s*([\d.eE+-]+)/m)?.[1]);
  const origin = text
    .match(/^origin:\s*\[([^\]]*)\]/m)?.[1]
    ?.split(',')
    .map(value => Number(value.trim()));
  const mode = text.match(/^mode:\s*(\w+)/m)?.[1];
  return {
    resolution: Number.isFinite(resolution) && resolution > 0 ? resolution : null,
    origin: origin?.length === 3 && origin.every(Number.isFinite) ? origin : null,
    mode: mode ?? 'trinary',
  };
};

export const checkPgm = (head: string, size: number, resolution: number | null): FileCheck => {
  const header = readPgmHeader(head);
  if (!header) return { ok: false, text: 'Not a binary PGM (P5) image' };
  if (header.maxVal > 255) return { ok: false, text: 'Only 8-bit images are supported' };
  const metres = resolution
    ? ` · ${(header.width * resolution).toFixed(1)} × ${(header.height * resolution).toFixed(1)} m`
    : '';
  return { ok: true, text: `${header.width} × ${header.height} px${metres} · ${kilobytes(size)}` };
};

export const checkYaml = (text: string): FileCheck => {
  const { resolution, origin, mode } = readMapYaml(text);
  if (!resolution || !origin) return { ok: false, text: 'Needs a resolution and an origin' };
  if (origin[2] !== 0) return { ok: false, text: 'origin yaw must be 0' };
  const place = origin.map(value => String(value).replace('-', '−')).join(', ');
  return { ok: true, text: `resolution ${resolution} · origin ${place} · ${mode}` };
};

const count = (items: unknown, one: string, many: string) => {
  const n = Array.isArray(items) ? items.length : 0;
  return `${n} ${n === 1 ? one : many}`;
};

export const checkMetadata = (text: string): FileCheck => {
  try {
    const parsed = JSON.parse(text) as { locationTags?: unknown; missions?: unknown };
    return {
      ok: true,
      text: `${count(parsed.locationTags, 'location tag', 'location tags')} · ${count(parsed.missions, 'mission', 'missions')}`,
    };
  } catch {
    return { ok: false, text: 'Not valid JSON' };
  }
};
