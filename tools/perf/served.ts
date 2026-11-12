// Served-bytes harness for the eng perf ledger: what a first visit to the sign-in page transfers from
// a running stack (index.html, the scripts and styles it links, the logo), compressed as nginx sends
// it, and how many of those files a repeat visit may reuse without asking.
// E2E_WEB=http://127.0.0.1:18080 bun tools/perf/served.ts
const WEB = process.env['E2E_WEB'] ?? 'http://127.0.0.1:18080';

const transfer = async (path: string) => {
  const response = await fetch(new URL(path, WEB), {
    headers: { 'accept-encoding': 'gzip' },
    decompress: false,
  } as RequestInit);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const bytes = (await response.arrayBuffer()).byteLength;
  const cacheControl = response.headers.get('cache-control') ?? '';
  return { bytes, cacheable: /immutable|max-age=[1-9]/.test(cacheControl) };
};

const indexResponse = await fetch(new URL('/auth/login', WEB));
const html = await indexResponse.text();
const linked = [...html.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css|png|svg))"/g)].map(
  m => m[1] as string
);
const files = await Promise.all(['/auth/login', ...new Set(linked)].map(transfer));

const unit = 'dashboard-ui:/auth/login';
const line = (metric: string, value: number) =>
  console.log(JSON.stringify({ unit, metric, value, env: 'local' }));
line(
  'transfer_bytes',
  files.reduce((total, file) => total + file.bytes, 0)
);
line('uncached_repeat_count', files.filter(file => !file.cacheable).length);
