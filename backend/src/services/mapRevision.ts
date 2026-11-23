import { createHash } from 'node:crypto';

// JSON with keys in code-unit order and undefined dropped, so a revision never depends on the
// server's locale or on the order an object was built in. contentHash keeps its own older
// stringify (mapAssets.ts) so hashes already stored stay valid.
export const canonicalJson = (value: unknown): string => {
  if (value === null || value === undefined || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
};

export const sha256 = (data: string | Uint8Array) =>
  createHash('sha256').update(data).digest('hex');

export interface MapRevisionInput {
  imageSha256: string;
  yaml: Record<string, unknown>;
  features: unknown;
}

// A map's identity: its image, how robots read it, and its features. Not the image filename, which
// each robot sets for its own copy. A robot's manifest carries all three, so copies compare
// without downloading the image.
export const mapRevision = ({ imageSha256, yaml, features }: MapRevisionInput) => {
  const { image: _image, ...readAs } = yaml;
  return sha256(canonicalJson({ v: 1, image: imageSha256, yaml: readAs, features }));
};

export type RobotCopyDecision = 'up_to_date' | 'behind' | 'take_robot' | 'conflict';

export interface RobotCopyInput {
  // The revision the robot holds now.
  incomingRev: string;
  // The dashboard's revision of the map linked under that filename.
  currentRev: string | null;
  // The revision the robot last confirmed holding: by a push ack or an import.
  pushedRev: string | null;
  // Whether the map was ever edited in the dashboard.
  edited: boolean;
  // Resolving a conflict in the robot's favour.
  acceptRobot?: boolean;
}

// The import rules, in order. A dashboard edit is never overwritten silently: when both sides
// changed it is a conflict for a person to resolve.
export const decideRobotCopy = ({
  incomingRev,
  currentRev,
  pushedRev,
  edited,
  acceptRobot = false,
}: RobotCopyInput): RobotCopyDecision => {
  if (incomingRev === currentRev) return 'up_to_date';
  if (acceptRobot) return 'take_robot';
  if (pushedRev) {
    if (incomingRev === pushedRev) return 'behind';
    if (pushedRev === currentRev) return 'take_robot';
    return 'conflict';
  }
  // A link from before revisions has no baseline: an unedited map follows its robot as it always did.
  return edited ? 'conflict' : 'take_robot';
};
