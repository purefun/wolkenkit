import axios from 'axios';
import { errors } from '../../../../common/errors';
import { FilterHeartbeatsFromJsonStreamTransform } from '../../../../common/utils/http/FilterHeartbeatsFromJsonStreamTransform';
import { flaschenpost } from 'flaschenpost';
import { HttpClient } from '../../../shared/HttpClient';
import { LockMetadata } from '../../../../stores/priorityQueueStore/LockMetadata';
import { PassThrough, pipeline } from 'stream';

const logger = flaschenpost.getLogger();

class Client<TItem> extends HttpClient {
  protected createItemInstance: ({ item }: { item: TItem }) => TItem;

  public constructor ({
    protocol = 'http',
    hostName,
    port,
    path = '/',
    createItemInstance = ({ item }: { item: TItem }): TItem => item
  }: {
    protocol?: string;
    hostName: string;
    port: number;
    path?: string;
    createItemInstance: ({ item }: { item: TItem }) => TItem;
  }) {
    super({ protocol, hostName, port, path });

    this.createItemInstance = createItemInstance;
  }

  public async awaitItem (): Promise<{ item: TItem; metadata: LockMetadata }> {
    const { data } = await axios({
      method: 'get',
      url: this.url,
      responseType: 'stream'
    });

    const passThrough = new PassThrough({ objectMode: true });
    const heartbeatFilter = new FilterHeartbeatsFromJsonStreamTransform();

    const { item, metadata } = await new Promise((resolve, reject): void => {
      let unsubscribe: () => void;

      const onData = (nextItem: any): void => {
        unsubscribe();
        resolve(nextItem);
      };
      const onError = (err: any): void => {
        unsubscribe();
        reject(err);
      };

      unsubscribe = (): void => {
        passThrough.off('data', onData);
        passThrough.off('error', onError);
      };

      passThrough.on('data', onData);
      passThrough.on('error', onError);

      pipeline(
        data,
        heartbeatFilter,
        passThrough,
        (err): void => {
          if (err) {
            reject(err);
          }
        }
      );
    });

    return {
      item: this.createItemInstance({ item }),
      metadata
    };
  }

  public async renewLock ({ discriminator, token }: {
    discriminator: string;
    token: string;
  }): Promise<void> {
    const { status, data } = await axios({
      method: 'post',
      url: `${this.url}/renew-lock`,
      data: { discriminator, token },
      validateStatus (): boolean {
        return true;
      }
    });

    if (status === 200) {
      return;
    }

    switch (data.code) {
      case 'ETOKENMISMATCH': {
        throw new errors.TokenMismatch(data.message);
      }
      case 'EREQUESTMALFORMED': {
        throw new errors.RequestMalformed(data.message);
      }
      case 'EITEMNOTFOUND': {
        throw new errors.ItemNotFound(data.message);
      }
      case 'EITEMNOTLOCKED': {
        throw new errors.ItemNotLocked(data.message);
      }
      default: {
        logger.error('An unknown error occured.', { ex: data, status });

        throw new errors.UnknownError();
      }
    }
  }

  public async acknowledge ({ discriminator, token }: {
    discriminator: string;
    token: string;
  }): Promise<void> {
    const { status, data } = await axios({
      method: 'post',
      url: `${this.url}/acknowledge`,
      data: { discriminator, token },
      validateStatus (): boolean {
        return true;
      }
    });

    if (status === 200) {
      return;
    }

    switch (data.code) {
      case 'ETOKENMISMATCH': {
        throw new errors.TokenMismatch(data.message);
      }
      case 'EREQUESTMALFORMED': {
        throw new errors.RequestMalformed(data.message);
      }
      case 'EITEMNOTFOUND': {
        throw new errors.ItemNotFound(data.message);
      }
      case 'EITEMNOTLOCKED': {
        throw new errors.ItemNotLocked(data.message);
      }
      default: {
        logger.error('An unknown error occured.', { ex: data, status });

        throw new errors.UnknownError();
      }
    }
  }

  public async defer ({ discriminator, token, priority }: {
    discriminator: string;
    token: string;
    priority: number;
  }): Promise<void> {
    const { status, data } = await axios({
      method: 'post',
      url: `${this.url}/defer`,
      data: { discriminator, token, priority },
      validateStatus (): boolean {
        return true;
      }
    });

    if (status === 200) {
      return;
    }

    switch (data.code) {
      case 'ETOKENMISMATCH': {
        throw new errors.TokenMismatch(data.message);
      }
      case 'EREQUESTMALFORMED': {
        throw new errors.RequestMalformed(data.message);
      }
      case 'EITEMNOTFOUND': {
        throw new errors.ItemNotFound(data.message);
      }
      case 'EITEMNOTLOCKED': {
        throw new errors.ItemNotLocked(data.message);
      }
      default: {
        logger.error('An unknown error occured.', { ex: data, status });

        throw new errors.UnknownError();
      }
    }
  }
}

export { Client };
