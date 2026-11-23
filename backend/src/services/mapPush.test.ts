import { afterEach, expect, test } from 'bun:test';
import { gunzipSync } from 'node:zlib';
import { WebSocketServer } from 'ws';
import { deleteMap, putMap, RobotMapError } from './mapPush.js';

const servers: WebSocketServer[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

// A mapping bridge that answers each message with `reply`, or stays silent when it returns null.
const robot = async (reply: (message: any) => unknown) => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  servers.push(server);
  const received: any[] = [];
  server.on('connection', socket =>
    socket.on('message', data => {
      const message = JSON.parse(data.toString());
      received.push(message);
      const answer = reply(message);
      if (answer) socket.send(JSON.stringify(answer));
    })
  );
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address() as { port: number };
  return { url: `ws://127.0.0.1:${port}`, received };
};

const pgm = Buffer.concat([Buffer.from('P5\n2 2\n255\n'), Buffer.from([0, 254, 205, 254])]);
const input = {
  mode: 'create' as const,
  stem: 'map4',
  yamlText: 'image: map4.pgm\n',
  pgm,
  metadata: { locationTags: [] },
  keepout: { yaml: 'image: keepout_map4.pgm\n', pgm },
};
const ack = (status: string, message?: string) => (request: any) => ({
  event: `${request.event}_ACK`,
  payload: { transferId: request.payload.transferId, status, ...(message ? { message } : {}) },
});

test('a stored map comes back with its ack, and the robot got the files it needs', async () => {
  const bridge = await robot(ack('stored'));
  expect((await putMap(bridge, input)).status).toBe('stored');
  const [sent] = bridge.received;
  expect(sent.event).toBe('PUT_MAP');
  expect(gunzipSync(Buffer.from(sent.payload.map_pgm_gzip, 'base64'))).toEqual(pgm);
  expect(sent.payload).toMatchObject({
    mode: 'create',
    stem: 'map4',
    map_yaml_content: 'image: map4.pgm\n',
  });
  expect(sent.payload.sha256).toHaveLength(64);
  expect(sent.payload.keepout_yaml_content).toBe('image: keepout_map4.pgm\n');
});

test('"exists" and "error" acks come back for the job to act on', async () => {
  expect((await putMap(await robot(ack('exists')), input)).status).toBe('exists');
  const refused = await putMap(await robot(ack('error', 'disk full')), input);
  expect(refused).toMatchObject({ status: 'error', message: 'disk full' });
});

test("today's robots answer Unknown event: that reads as unsupported", async () => {
  const bridge = await robot(() => ({
    event: 'ERROR',
    payload: { message: 'Unknown event: PUT_MAP' },
  }));
  const error = await putMap(bridge, input).catch(caught => caught);
  expect(error).toBeInstanceOf(RobotMapError);
  expect(error.kind).toBe('unsupported');
});

test('a robot that never answers times out, and one that is not there is unreachable', async () => {
  const silent = await robot(() => null);
  const timeout = await putMap({ ...silent, ackTimeoutMs: 100 }, input).catch(caught => caught);
  expect(timeout.kind).toBe('timeout');

  const unreachable = await putMap({ url: 'ws://127.0.0.1:9' }, input).catch(caught => caught);
  expect(unreachable.kind).toBe('unreachable');
});

test('an ack for another transfer is not taken as ours', async () => {
  const bridge = await robot(request => ({
    event: 'PUT_MAP_ACK',
    payload: { transferId: `${request.payload.transferId}-other`, status: 'stored' },
  }));
  const error = await putMap({ ...bridge, ackTimeoutMs: 100 }, input).catch(caught => caught);
  expect(error.kind).toBe('timeout');
});

test('delete sends the stem and returns the ack', async () => {
  const bridge = await robot(ack('deleted'));
  expect((await deleteMap(bridge, 'map4')).status).toBe('deleted');
  expect(bridge.received[0]).toMatchObject({ event: 'DELETE_MAP', payload: { stem: 'map4' } });
});
