import { assert } from 'assertthat';
import { Infrastructure } from '../../server/infrastructure';
import { Message } from '../../server/types/Message';
import path from 'path';
import { v4 } from 'uuid';
import { Application, loadApplication, Notification, sandbox } from 'wolkenkit';

suite('messages', (): void => {
  let application: Application;

  setup(async (): Promise<void> => {
    application = await loadApplication({
      applicationDirectory: path.join(__dirname, '..', '..')
    });
  });

  test('adds sent messages to the messages view.', async (): Promise<void> => {
    const aggregateId = v4(),
          text = 'Hello world!',
          timestamp = Date.now();

    await sandbox().
      withApplication({ application }).
      forFlow({ flowName: 'messages' }).
      when({
        contextIdentifier: { name: 'communication' },
        aggregateIdentifier: { name: 'message', id: aggregateId },
        name: 'sent',
        data: { text },
        metadata: { revision: 1, timestamp }
      }).
      then(async (): Promise<void> => {
        const messages = (application.infrastructure as Infrastructure).tell.viewStore.messages as Message[];

        assert.that(messages.length).is.equalTo(1);
        assert.that(messages[0]).is.equalTo({
          id: aggregateId,
          timestamp,
          text,
          likes: 0
        });
      });
  });

  test('increases likes.', async (): Promise<void> => {
    const aggregateId = v4();

    await sandbox().
      withApplication({ application }).
      forFlow({ flowName: 'messages' }).
      when({
        contextIdentifier: { name: 'communication' },
        aggregateIdentifier: { name: 'message', id: aggregateId },
        name: 'sent',
        data: { text: 'Hello world!' },
        metadata: { revision: 1 }
      }).
      and({
        contextIdentifier: { name: 'communication' },
        aggregateIdentifier: { name: 'message', id: aggregateId },
        name: 'liked',
        data: { likes: 5 },
        metadata: { revision: 2 }
      }).
      then(async (): Promise<void> => {
        const messages = (application.infrastructure as Infrastructure).tell.viewStore.messages as Message[];

        assert.that(messages.length).is.equalTo(1);
        assert.that(messages[0]).is.atLeast({
          id: aggregateId,
          likes: 5
        });
      });
  });

  test('publishes flow updated notification.', async (): Promise<void> => {
    const aggregateId = v4();

    const notifications: { channel: string; notification: Notification }[] = [];
    const publisher = {
      async publish ({ channel, message }: { channel: string; message: any }): Promise<void> {
        notifications.push({ channel, notification: message });
      }
    };

    await sandbox().
      withApplication({ application }).
      withPublisher({ publisher }).
      forFlow({ flowName: 'messages' }).
      when({
        contextIdentifier: { name: 'communication' },
        aggregateIdentifier: { name: 'message', id: aggregateId },
        name: 'sent',
        data: { text: 'Hello world!' },
        metadata: { revision: 1 }
      }).
      then(async (): Promise<void> => {
        assert.that(notifications.length).is.equalTo(1);
        assert.that(notifications[0]).is.equalTo({
          channel: 'notifications',
          notification: {
            name: 'flowMessagesUpdated',
            data: {},
            metadata: undefined
          }
        });
      });
  });
});
