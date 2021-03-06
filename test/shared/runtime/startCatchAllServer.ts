import bodyParser from 'body-parser';
import cors from 'cors';
import express from 'express';
import { flaschenpost } from 'flaschenpost';
import http from 'http';
import { WolkenkitRequestHandler } from '../../../lib/apis/base/WolkenkitRequestHandler';

const logger = flaschenpost.getLogger();

const startCatchAllServer = async function ({ port, onRequest, parseJson = true }: {
  port: number;
  onRequest: WolkenkitRequestHandler;
  parseJson?: boolean;
}): Promise<void> {
  const app = express();

  app.use(cors());

  if (parseJson) {
    app.use(bodyParser.json());
  }

  app.all('*', onRequest);

  const server = http.createServer(app);

  await new Promise<void>((resolve, reject): void => {
    try {
      server.on('error', (err): void => {
        reject(err);
      });

      server.listen(port, (): void => {
        logger.info('Catch all server started.', { port });
        resolve();
      });
    } catch (ex: unknown) {
      reject(ex);
    }
  });
};

export { startCatchAllServer };
