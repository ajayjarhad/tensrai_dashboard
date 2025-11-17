console.log('1. Starting imports...');

import dotenv from 'dotenv';
import Fastify from 'fastify';

console.log('2. Basic imports successful');

// Load environment variables
dotenv.config();

console.log('3. Environment loaded');

const server = Fastify({
  logger: false,
});

console.log('4. Fastify instance created');

server.get('/', async () => ({ message: 'Test API' }));

console.log('5. Route registered');

const start = async () => {
  try {
    await server.listen({ port: 5002, host: '0.0.0.0' });
    console.log('🚀 Test server started on http://0.0.0.0:5002');
  } catch (err) {
    console.log('Failed to start:', err);
    process.exit(1);
  }
};

console.log('6. Starting server...');
start();
