import { assert } from 'assertthat';
import { CustomError } from 'defekt';
import { FileStore } from '../../../../lib/stores/fileStore/FileStore';
import path from 'path';
import streamToString from 'stream-to-string';
import { uuid } from 'uuidv4';
import { createReadStream, ReadStream } from 'fs';

/* eslint-disable mocha/max-top-level-suites, mocha/no-top-level-hooks */
const getTestsFor = function ({ createFileStore }: {
  createFileStore (): Promise<FileStore>;
}): void {
  const contentType = 'application/json',
        fileName = 'someFile.json';

  let content: string,
      contentLength: number,
      fileStore: FileStore,
      id: string,
      stream: ReadStream;

  setup(async (): Promise<void> => {
    id = uuid();

    const filePath = path.join(__dirname, '..', '..', '..', 'shared', 'files', 'someFile.json');

    content = await streamToString(createReadStream(filePath));
    contentLength = content.length;
    stream = createReadStream(filePath);
  });

  suite('addFile', (): void => {
    setup(async (): Promise<void> => {
      fileStore = await createFileStore();
    });

    test('does not throw an error.', async (): Promise<void> => {
      await assert.that(async (): Promise<void> => {
        await fileStore.addFile({ id, fileName, contentType, stream });
      }).is.not.throwingAsync();
    });

    test('throws an error if the id is already being used.', async (): Promise<void> => {
      await fileStore.addFile({ id, fileName, contentType, stream });

      await assert.that(async (): Promise<void> => {
        await fileStore.addFile({ id, fileName, contentType, stream });
      }).is.throwingAsync((ex: Error): boolean => (ex as CustomError).code === 'EFILEALREADYEXISTS');
    });
  });

  suite('getMetadata', (): void => {
    setup(async (): Promise<void> => {
      fileStore = await createFileStore();
    });

    test('throws an error if the id does not exist.', async (): Promise<void> => {
      await assert.that(async (): Promise<void> => {
        await fileStore.getMetadata({ id });
      }).is.throwingAsync((ex: Error): boolean => (ex as CustomError).code === 'EFILENOTFOUND');
    });

    test('return the metadata.', async (): Promise<void> => {
      await fileStore.addFile({ id, fileName, contentType, stream });

      const metadata = await fileStore.getMetadata({ id });

      assert.that(metadata).is.equalTo({ id, fileName, contentType, contentLength });
    });
  });

  suite('getFile', (): void => {
    setup(async (): Promise<void> => {
      fileStore = await createFileStore();
    });

    test('throws an error if the id does not exist.', async (): Promise<void> => {
      await assert.that(async (): Promise<void> => {
        await fileStore.getFile({ id });
      }).is.throwingAsync((ex: Error): boolean => (ex as CustomError).code === 'EFILENOTFOUND');
    });

    test('return the file stream.', async (): Promise<void> => {
      await fileStore.addFile({ id, fileName, contentType, stream });

      const fileStream = await fileStore.getFile({ id });
      const fileData = await streamToString(fileStream);

      assert.that(fileData).is.equalTo(content);
    });
  });

  suite('removeFile', (): void => {
    setup(async (): Promise<void> => {
      fileStore = await createFileStore();
    });

    test('throws an error if the id does not exist.', async (): Promise<void> => {
      await assert.that(async (): Promise<void> => {
        await fileStore.removeFile({ id });
      }).is.throwingAsync((ex: Error): boolean => (ex as CustomError).code === 'EFILENOTFOUND');
    });

    test('does not throw an error.', async (): Promise<void> => {
      await fileStore.addFile({ id, fileName, contentType, stream });

      await assert.that(async (): Promise<void> => {
        await fileStore.removeFile({ id });
      }).is.not.throwingAsync();
    });
  });
};
/* eslint-enable mocha/max-top-level-suites, mocha/no-top-level-hooks */

export { getTestsFor };
