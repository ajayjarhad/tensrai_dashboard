import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './app/index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

const render = () =>
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>
  );

// The tracing SDK, with zone.js patching every async API, is downloaded only when tracing is on,
// and the app waits for it so the first requests are traced.
const otlpEndpoint = import.meta.env['VITE_OTEL_EXPORTER_OTLP_ENDPOINT'];
if (otlpEndpoint) {
  import('./otel')
    .then(({ startTracing }) => startTracing(otlpEndpoint))
    .catch(error => console.warn('Tracing failed to start', error))
    .finally(render);
} else {
  render();
}
