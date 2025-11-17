import type { IncomingMessage, ServerResponse } from 'node:http';

export type BetterAuthHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;
