import { expect, test } from 'bun:test';
import { WebSocketServer } from 'ws';
import { RosBridgeConnection } from './rosBridgeConnection.js';

const until = async (predicate: () => boolean) => {
  const deadline = Date.now() + 2_000;
  while (!predicate() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

test('frames a rosbridge should never send are errors, not the end of the process', async () => {
  const garbage: (string | Uint8Array)[] = [
    'not json',
    'null',
    '7',
    new Uint8Array([1, 2, 3]),
    '{"op":"publish","topic":"/odom_ui","msg":null}',
    '{"op":"png","data":"AAAA"}',
  ];
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(resolve => server.once('listening', resolve));
  server.on('connection', socket => {
    socket.on('message', () => {
      for (const frame of garbage) socket.send(frame);
      socket.send('{"op":"publish","topic":"/odom_ui","msg":{"seq":1}}');
    });
  });
  const { port } = server.address() as { port: number };

  const connection = new RosBridgeConnection({ id: 'test', url: `ws://127.0.0.1:${port}` });
  const errors: Error[] = [];
  connection.on('error', error => errors.push(error));
  await connection.connect();

  const received: any[] = [];
  connection.subscribe<any>('/odom_ui', 'nav_msgs/msg/Odometry', message => {
    received.push(message);
    // A subscriber tripping over a message is the same failure, one level further in.
    if (message === null) throw new TypeError('null message');
  });

  await until(() => received.some(message => message?.seq === 1));
  expect(received.some(message => message?.seq === 1)).toBe(true);
  expect(errors.length).toBeGreaterThan(0);
  expect(connection.isConnected()).toBe(true);

  connection.disconnect();
  for (const client of server.clients) client.terminate();
  server.close();
});
