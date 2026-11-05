import { afterEach, expect, test } from 'bun:test';
import { createServer } from 'node:http';

const closeFns: Array<() => Promise<void>> = [];

const listen = async (server: ReturnType<typeof createServer>) =>
  new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to bind test API server'));
        return;
      }
      resolve(address.port);
    });
  });

afterEach(async () => {
  delete process.env.VITE_API_URL;
  while (closeFns.length > 0) {
    await closeFns.pop()?.();
  }
});

test('post without data does not send an empty JSON body', async () => {
  const requests: Array<{ body: string; headers: Record<string, string | string[] | undefined> }> =
    [];
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => {
      body += chunk;
    });
    request.on('end', () => {
      requests.push({ body, headers: request.headers });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ success: true }));
    });
  });

  const port = await listen(server);
  closeFns.push(
    () =>
      new Promise(resolve => {
        server.close(() => resolve());
      })
  );
  process.env.VITE_API_URL = `http://127.0.0.1:${port}/api`;

  const { apiClient } = await import(`../src/lib/api.ts?empty-post-${Date.now()}`);

  await apiClient.post('robots/robot-1/map-sync');

  expect(requests).toHaveLength(1);
  expect(requests[0]?.body).toBe('');
  expect(requests[0]?.headers['content-type']).toBeUndefined();
});
