import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp, resolvePort } from './app';

/**
 * Process entry point. Boots the Nest app and binds the configured port.
 *
 * `0.0.0.0` is used so the server is reachable from the Vite dev proxy (and from
 * containers/other hosts later) rather than only loopback. Startup failures are
 * logged and exit non-zero so the process manager / gates surface a red signal
 * instead of a silently dead server.
 */
async function bootstrap(): Promise<void> {
  const app = await createApp();
  const port = resolvePort();
  await app.listen(port, '0.0.0.0');
  Logger.log(`API listening on http://0.0.0.0:${port}`, 'Bootstrap');
}

bootstrap().catch((error) => {
  Logger.error(error, undefined, 'Bootstrap');
  process.exitCode = 1;
});
