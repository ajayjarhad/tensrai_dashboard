import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { DeleteMapAck, PutMapAck, PutMapMode, RobotMapMessage } from '@tensrai/shared';
import WebSocket from 'ws';
import { sha256 } from './mapRevision.js';

// How a robot answered, in words a person can act on. `unsupported` is today's dashboard_ros, which
// replies "Unknown event" to anything but GET_MAP_DATA.
export type RobotMapErrorKind = 'unreachable' | 'timeout' | 'rejected' | 'unsupported';

export class RobotMapError extends Error {
  constructor(
    readonly kind: RobotMapErrorKind,
    message: string
  ) {
    super(message);
  }
}

const ACK_TIMEOUT_MS = 30_000;
// Gzipped grids are usually tens to hundreds of KiB; this bounds what a robot can send back.
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

export type MapBridgeTarget = { url: string; ackTimeoutMs?: number };

// One request, one ack, over a fresh mapping-bridge socket.
const exchange = <Ack extends { transferId: string }>(
  target: MapBridgeTarget,
  message: RobotMapMessage,
  ackEvent: string
) =>
  new Promise<Ack>((resolve, reject) => {
    const socket = new WebSocket(target.url, {
      maxPayload: MAX_FRAME_BYTES,
      handshakeTimeout: 10_000,
    });
    let settled = false;
    const finish = (outcome: Ack | RobotMapError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.on('error', () => {});
      socket.terminate();
      if (outcome instanceof RobotMapError) reject(outcome);
      else resolve(outcome);
    };
    const timer = setTimeout(
      () => finish(new RobotMapError('timeout', "The robot didn't answer in time.")),
      target.ackTimeoutMs ?? ACK_TIMEOUT_MS
    );

    socket.on('open', () => socket.send(JSON.stringify(message)));
    socket.on('message', data => {
      let parsed: { event?: unknown; payload?: Record<string, unknown> } | null = null;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (
        parsed?.event === ackEvent &&
        parsed.payload?.['transferId'] === message.payload.transferId
      ) {
        finish(parsed.payload as unknown as Ack);
        return;
      }
      if (parsed?.event === 'ERROR') {
        const text = String(parsed.payload?.['message'] ?? 'The robot reported an error.');
        finish(new RobotMapError(/unknown event/i.test(text) ? 'unsupported' : 'rejected', text));
      }
    });
    socket.on('error', () =>
      finish(new RobotMapError('unreachable', "Couldn't reach the robot's mapping bridge."))
    );
    socket.on('close', () =>
      finish(new RobotMapError('unreachable', 'The robot closed the connection before answering.'))
    );
  });

export interface PutMapInput {
  mode: PutMapMode;
  stem: string;
  yamlText: string;
  pgm: Buffer;
  metadata: Record<string, unknown>;
  keepout: { yaml: string; pgm: Buffer };
}

export const putMap = (target: MapBridgeTarget, input: PutMapInput) =>
  exchange<PutMapAck>(
    target,
    {
      event: 'PUT_MAP',
      payload: {
        transferId: randomUUID(),
        mode: input.mode,
        stem: input.stem,
        map_yaml_content: input.yamlText,
        map_pgm_gzip: gzipSync(input.pgm).toString('base64'),
        sha256: sha256(input.pgm),
        metadata_json: input.metadata,
        keepout_yaml_content: input.keepout.yaml,
        keepout_pgm_gzip: gzipSync(input.keepout.pgm).toString('base64'),
      },
    },
    'PUT_MAP_ACK'
  );

export const deleteMap = (target: MapBridgeTarget, stem: string) =>
  exchange<DeleteMapAck>(
    target,
    { event: 'DELETE_MAP', payload: { transferId: randomUUID(), stem } },
    'DELETE_MAP_ACK'
  );
