import Fastify from 'fastify';

const server = Fastify({
  logger: true,
});

server.get('/', async () => {
  return { message: 'Robot Dashboard API' };
});

const start = async () => {
  try {
    const port = Number(process.env['PORT']) || 5001;
    await server.listen({ port, host: '0.0.0.0' });
    console.log(`Server listening on port ${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
