// Dashboard → robot map delivery over the mapping bridge (port 8765). docs/robot-map-protocol.md is
// the spec the robot team builds against; the mock robot in tools/e2e implements it.

export type PutMapMode = 'create' | 'replace';

export interface PutMapPayload {
  transferId: string;
  // create refuses a stem that exists; replace swaps the files in place.
  mode: PutMapMode;
  // File stem on the robot: map4 → map4.yaml, map4.pgm and keepout_map4.{yaml,pgm}.
  stem: string;
  map_yaml_content: string;
  // Base64 of the gzipped PGM, and the sha256 of the PGM itself.
  map_pgm_gzip: string;
  sha256: string;
  // metadata.json v2, written as received.
  metadata_json: Record<string, unknown>;
  keepout_yaml_content: string;
  keepout_pgm_gzip: string;
}

export interface PutMapAck {
  transferId: string;
  status: 'stored' | 'exists' | 'error';
  message?: string;
}

export interface DeleteMapPayload {
  transferId: string;
  stem: string;
}

export interface DeleteMapAck {
  transferId: string;
  status: 'deleted' | 'error';
  message?: string;
}

export type RobotMapMessage =
  | { event: 'PUT_MAP'; payload: PutMapPayload }
  | { event: 'DELETE_MAP'; payload: DeleteMapPayload };

export type RobotMapReply =
  | { event: 'PUT_MAP_ACK'; payload: PutMapAck }
  | { event: 'DELETE_MAP_ACK'; payload: DeleteMapAck };
