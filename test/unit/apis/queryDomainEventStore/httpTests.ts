import { AggregateIdentifier } from '../../../../lib/common/elements/AggregateIdentifier';
import { Application } from 'express';
import { asJsonStream } from '../../../shared/http/asJsonStream';
import { assert } from 'assertthat';
import { buildDomainEvent } from '../../../../lib/common/utils/test/buildDomainEvent';
import { createDomainEventStore } from '../../../../lib/stores/domainEventStore/createDomainEventStore';
import { DomainEventStore } from '../../../../lib/stores/domainEventStore/DomainEventStore';
import { errors } from '../../../../lib/common/errors';
import { getApi } from '../../../../lib/apis/queryDomainEventStore/http';
import { runAsServer } from '../../../shared/http/runAsServer';
import { Snapshot } from '../../../../lib/stores/domainEventStore/Snapshot';
import { v4 } from 'uuid';
import { waitForSignals } from 'wait-for-signals';

suite('queryDomainEventStore/http', (): void => {
  suite('/v2', (): void => {
    let api: Application,
        domainEventStore: DomainEventStore;

    setup(async (): Promise<void> => {
      domainEventStore = await createDomainEventStore({
        type: 'InMemory'
      });

      ({ api } = await getApi({
        corsOrigin: '*',
        domainEventStore
      }));
    });

    suite('GET /replay', (): void => {
      test('returns a stream that sends a heartbeat and then ends instantly if there are no domain events to deliver.', async (): Promise<void> => {
        const { client } = await runAsServer({ app: api });

        const { status, data, headers } = await client({
          method: 'get',
          url: '/v2/replay',
          responseType: 'stream'
        });

        assert.that(status).is.equalTo(200);
        assert.that(headers['content-type']).is.equalTo('application/x-ndjson');

        await new Promise<void>((resolve, reject): void => {
          data.on('data', (stuff: any): void => {
            try {
              assert.that(JSON.parse(stuff.toString())).is.equalTo({ name: 'heartbeat' });
            } catch (ex: unknown) {
              reject(ex);
            }
          });
          data.on('error', reject);
          data.on('end', resolve);
        });
      });

      test('returns a stream that sends a heartbeat and then all domain events.', async (): Promise<void> => {
        const aggregateIdentifier: AggregateIdentifier = {
          name: 'sampleAggregate',
          id: v4()
        };

        const firstDomainEvent = buildDomainEvent({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier,
          name: 'succeeded',
          data: {},
          metadata: {
            revision: 1,
            initiator: { user: { id: 'jane.doe', claims: { sub: 'jane.doe' }}}
          }
        });
        const secondDomainEvent = buildDomainEvent({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier,
          name: 'succeeded',
          data: {},
          metadata: {
            revision: 2,
            initiator: { user: { id: 'jane.doe', claims: { sub: 'jane.doe' }}}
          }
        });

        await domainEventStore.storeDomainEvents({ domainEvents: [ firstDomainEvent, secondDomainEvent ]});

        const { client } = await runAsServer({ app: api });

        const { status, data, headers } = await client({
          method: 'get',
          url: '/v2/replay',
          responseType: 'stream'
        });

        assert.that(status).is.equalTo(200);
        assert.that(headers['content-type']).is.equalTo('application/x-ndjson');

        await new Promise<void>((resolve, reject): void => {
          let counter = 0;

          data.on('error', reject);
          data.on('end', (): void => {
            if (counter === 3) {
              resolve();
            } else {
              reject(new Error('Not all expected messages were received.'));
            }
          });

          data.pipe(asJsonStream([
            (heartbeat): void => {
              assert.that(heartbeat).is.equalTo({ name: 'heartbeat' });
              counter += 1;
            },
            (domainEvent): void => {
              assert.that(domainEvent).is.equalTo(firstDomainEvent);
              counter += 1;
            },
            (domainEvent): void => {
              assert.that(domainEvent).is.equalTo(secondDomainEvent);
              counter += 1;
            }
          ]));
        });
      });

      test('returns a stream that sends a heartbeat and then all domain events that match the given timestamp constraint.', async (): Promise<void> => {
        const aggregateIdentifier: AggregateIdentifier = {
          name: 'sampleAggregate',
          id: v4()
        };

        const firstDomainEvent = buildDomainEvent({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier,
          name: 'succeeded',
          data: {},
          metadata: {
            revision: 1,
            timestamp: 1,
            initiator: { user: { id: 'jane.doe', claims: { sub: 'jane.doe' }}}
          }
        });
        const secondDomainEvent = buildDomainEvent({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier,
          name: 'succeeded',
          data: {},
          metadata: {
            revision: 2,
            timestamp: 2,
            initiator: { user: { id: 'jane.doe', claims: { sub: 'jane.doe' }}}
          }
        });
        const thirdDomainEvent = buildDomainEvent({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier,
          name: 'succeeded',
          data: {},
          metadata: {
            revision: 3,
            timestamp: 3,
            initiator: { user: { id: 'jane.doe', claims: { sub: 'jane.doe' }}}
          }
        });

        await domainEventStore.storeDomainEvents({ domainEvents: [ firstDomainEvent, secondDomainEvent, thirdDomainEvent ]});

        const { client } = await runAsServer({ app: api });

        const { status, data, headers } = await client({
          method: 'get',
          url: '/v2/replay?fromTimestamp=3',
          responseType: 'stream'
        });

        assert.that(status).is.equalTo(200);
        assert.that(headers['content-type']).is.equalTo('application/x-ndjson');

        await new Promise<void>((resolve, reject): void => {
          let counter = 0;

          data.on('error', reject);
          data.on('end', (): void => {
            if (counter === 2) {
              resolve();
            } else {
              reject(new Error('Not all expected messages were received.'));
            }
          });

          data.pipe(asJsonStream([
            (heartbeat): void => {
              assert.that(heartbeat).is.equalTo({ name: 'heartbeat' });
              counter += 1;
            },
            (domainEvent): void => {
              assert.that(domainEvent).is.equalTo(thirdDomainEvent);
              counter += 1;
            }
          ]));
        });
      });

      test('returns 400 if the parameter fromTimestamp is less than 0.', async (): Promise<void> => {
        const { client } = await runAsServer({ app: api });

        const { status, data } = await client({
          method: 'get',
          url: '/v2/replay?fromTimestamp=-1',
          validateStatus: (): boolean => true
        });

        assert.that(status).is.equalTo(400);
        assert.that(data).is.equalTo(`Value -1 is less than minimum 0 (at requestQuery.fromTimestamp).`);
      });

      test('returns 400 if the parameter fromTimestamp is not a number.', async (): Promise<void> => {
        const { client } = await runAsServer({ app: api });

        const { status, data } = await client({
          method: 'get',
          url: '/v2/replay?fromTimestamp=foo',
          validateStatus: (): boolean => true
        });

        assert.that(status).is.equalTo(400);
        assert.that(data).is.equalTo(`Invalid type: string should be number (at requestQuery.fromTimestamp).`);
      });
    });

    suite('GET /replay/:aggregateId', (): void => {
      test('returns a stream that sends a heartbeat and then ends instantly if there are no domain events for the selected aggregate to deliver.', async (): Promise<void> => {
        const aggregateIdentifier: AggregateIdentifier = {
          name: 'sampleAggregate',
          id: v4()
        };
        const differentAggregateIdentifier: AggregateIdentifier = {
          name: 'sampleAggregate',
          id: v4()
        };

        const firstDomainEvent = buildDomainEvent({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier,
          name: 'succeeded',
          data: {},
          metadata: {
            revision: 1,
            initiator: { user: { id: 'jane.doe', claims: { sub: 'jane.doe' }}}
          }
        });

        await domainEventStore.storeDomainEvents({ domainEvents: [ firstDomainEvent ]});

        const { client } = await runAsServer({ app: api });

        const { status, data, headers } = await client({
          method: 'get',
          url: `/v2/replay/${differentAggregateIdentifier.id}`,
          responseType: 'stream'
        });

        assert.that(status).is.equalTo(200);
        assert.that(headers['content-type']).is.equalTo('application/x-ndjson');

        await new Promise<void>((resolve, reject): void => {
          data.on('data', (stuff: any): void => {
            try {
              assert.that(JSON.parse(stuff.toString())).is.equalTo({ name: 'heartbeat' });
            } catch (ex: unknown) {
              reject(ex);
            }
          });
          data.on('error', reject);
          data.on('end', resolve);
        });
      });

      test('returns a stream that sends a heartbeat and then all domain events.', async (): Promise<void> => {
        const aggregateIdentifier: AggregateIdentifier = {
          name: 'sampleAggregate',
          id: v4()
        };

        const firstDomainEvent = buildDomainEvent({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier,
          name: 'succeeded',
          data: {},
          metadata: {
            revision: 1,
            initiator: { user: { id: 'jane.doe', claims: { sub: 'jane.doe' }}}
          }
        });
        const secondDomainEvent = buildDomainEvent({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier,
          name: 'succeeded',
          data: {},
          metadata: {
            revision: 2,
            initiator: { user: { id: 'jane.doe', claims: { sub: 'jane.doe' }}}
          }
        });

        await domainEventStore.storeDomainEvents({ domainEvents: [ firstDomainEvent, secondDomainEvent ]});

        const { client } = await runAsServer({ app: api });

        const { status, data, headers } = await client({
          method: 'get',
          url: `/v2/replay/${aggregateIdentifier.id}`,
          responseType: 'stream'
        });

        assert.that(status).is.equalTo(200);
        assert.that(headers['content-type']).is.equalTo('application/x-ndjson');

        await new Promise<void>((resolve, reject): void => {
          let counter = 0;

          data.on('error', reject);
          data.on('end', (): void => {
            if (counter === 3) {
              resolve();
            } else {
              reject(new Error('Not all expected messages were received.'));
            }
          });

          data.pipe(asJsonStream([
            (heartbeat): void => {
              assert.that(heartbeat).is.equalTo({ name: 'heartbeat' });
              counter += 1;
            },
            (domainEvent): void => {
              assert.that(domainEvent).is.equalTo(firstDomainEvent);
              counter += 1;
            },
            (domainEvent): void => {
              assert.that(domainEvent).is.equalTo(secondDomainEvent);
              counter += 1;
            }
          ]));
        });
      });

      test('returns a stream that sends a heartbeat and then all domain events that match the given revision constraints.', async (): Promise<void> => {
        const aggregateIdentifier: AggregateIdentifier = {
          name: 'sampleAggregate',
          id: v4()
        };

        const firstDomainEvent = buildDomainEvent({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier,
          name: 'succeeded',
          data: {},
          metadata: {
            revision: 1,
            initiator: { user: { id: 'jane.doe', claims: { sub: 'jane.doe' }}}
          }
        });
        const secondDomainEvent = buildDomainEvent({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier,
          name: 'succeeded',
          data: {},
          metadata: {
            revision: 2,
            initiator: { user: { id: 'jane.doe', claims: { sub: 'jane.doe' }}}
          }
        });
        const thirdDomainEvent = buildDomainEvent({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier,
          name: 'succeeded',
          data: {},
          metadata: {
            revision: 3,
            initiator: { user: { id: 'jane.doe', claims: { sub: 'jane.doe' }}}
          }
        });

        await domainEventStore.storeDomainEvents({ domainEvents: [ firstDomainEvent, secondDomainEvent, thirdDomainEvent ]});

        const { client } = await runAsServer({ app: api });

        const { status, data, headers } = await client({
          method: 'get',
          url: `/v2/replay/${aggregateIdentifier.id}?fromRevision=2&toRevision=2`,
          responseType: 'stream'
        });

        assert.that(status).is.equalTo(200);
        assert.that(headers['content-type']).is.equalTo('application/x-ndjson');

        await new Promise<void>((resolve, reject): void => {
          let counter = 0;

          data.on('error', reject);
          data.on('end', (): void => {
            if (counter === 2) {
              resolve();
            } else {
              reject(new Error('Not all expected messages were received.'));
            }
          });

          data.pipe(asJsonStream([
            (heartbeat): void => {
              assert.that(heartbeat).is.equalTo({ name: 'heartbeat' });
              counter += 1;
            },
            (domainEvent): void => {
              assert.that(domainEvent).is.equalTo(secondDomainEvent);
              counter += 1;
            }
          ]));
        });
      });

      test('closes the stream once the given to-revision-global is reached and does not deliver it.', async (): Promise<void> => {
        const aggregateIdentifier: AggregateIdentifier = {
          name: 'sampleAggregate',
          id: v4()
        };

        const firstDomainEvent = buildDomainEvent({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier,
          name: 'succeeded',
          data: {},
          metadata: {
            revision: 1,
            initiator: { user: { id: 'jane.doe', claims: { sub: 'jane.doe' }}}
          }
        });
        const secondDomainEvent = buildDomainEvent({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier,
          name: 'succeeded',
          data: {},
          metadata: {
            revision: 2,
            initiator: { user: { id: 'jane.doe', claims: { sub: 'jane.doe' }}}
          }
        });

        await domainEventStore.storeDomainEvents({ domainEvents: [ firstDomainEvent, secondDomainEvent ]});

        const { client } = await runAsServer({ app: api });

        const { status, data, headers } = await client({
          method: 'get',
          url: `/v2/replay/${aggregateIdentifier.id}?toRevision=1`,
          responseType: 'stream'
        });

        assert.that(status).is.equalTo(200);
        assert.that(headers['content-type']).is.equalTo('application/x-ndjson');

        await new Promise<void>(async (resolve, reject): Promise<void> => {
          let counter = 0;

          data.on('error', reject);
          data.on('end', (): void => {
            if (counter === 2) {
              resolve();
            } else {
              reject(new Error('Did not receive the expected amount of messages.'));
            }
          });

          data.pipe(asJsonStream([
            (heartbeat): void => {
              assert.that(heartbeat).is.equalTo({ name: 'heartbeat' });
              counter += 1;
            },
            (): void => {
              counter += 1;
            },
            (): void => {
              reject(new Error('Should not have received more than one event.'));
            }
          ]));
        });
      });

      test('returns 400 if the parameter fromRevision is less than 1.', async (): Promise<void> => {
        const { client } = await runAsServer({ app: api });

        const { status, data } = await client({
          method: 'get',
          url: `/v2/replay/${v4()}?fromRevision=0`,
          validateStatus: (): boolean => true
        });

        assert.that(status).is.equalTo(400);
        assert.that(data).is.equalTo(`Value 0 is less than minimum 1 (at requestQuery.fromRevision).`);
      });

      test('returns 400 if the parameter fromRevision is not a number.', async (): Promise<void> => {
        const { client } = await runAsServer({ app: api });

        const { status, data } = await client({
          method: 'get',
          url: `/v2/replay/${v4()}?fromRevision=foo`,
          validateStatus: (): boolean => true
        });

        assert.that(status).is.equalTo(400);
        assert.that(data).is.equalTo(`Invalid type: string should be number (at requestQuery.fromRevision).`);
      });

      test('returns 400 if the parameter toRevision is less than 1.', async (): Promise<void> => {
        const { client } = await runAsServer({ app: api });

        const { status, data } = await client({
          method: 'get',
          url: `/v2/replay/${v4()}?toRevision=0`,
          validateStatus: (): boolean => true
        });

        assert.that(status).is.equalTo(400);
        assert.that(data).is.equalTo(`Value 0 is less than minimum 1 (at requestQuery.toRevision).`);
      });

      test('returns 400 if the parameter toRevision is not a number.', async (): Promise<void> => {
        const { client } = await runAsServer({ app: api });

        const { status, data } = await client({
          method: 'get',
          url: `/v2/replay/${v4()}?toRevision=foo`,
          validateStatus: (): boolean => true
        });

        assert.that(status).is.equalTo(400);
        assert.that(data).is.equalTo(`Invalid type: string should be number (at requestQuery.toRevision).`);
      });

      test(`returns 400 if the parameter 'fromRevision' is greater than 'toRevision'.`, async (): Promise<void> => {
        const { client } = await runAsServer({ app: api });

        const { status, data } = await client({
          method: 'get',
          url: `/v2/replay/${v4()}?fromRevision=4&toRevision=2`,
          validateStatus: (): boolean => true
        });

        assert.that(status).is.equalTo(400);
        assert.that(data).is.equalTo(`Query parameter 'toRevision' must be greater or equal to 'fromRevision'.`);
      });
    });

    suite('GET /last-domain-event', (): void => {
      test('retrieves the last domain event for a given aggregate identifier.', async (): Promise<void> => {
        const aggregateIdentifier: AggregateIdentifier = {
          name: 'sampleAggregate',
          id: v4()
        };

        const domainEvent = buildDomainEvent({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier,
          name: 'succeeded',
          data: {},
          metadata: {
            revision: 1,
            initiator: { user: { id: 'jane.doe', claims: { sub: 'jane.doe' }}}
          }
        });

        await domainEventStore.storeDomainEvents({ domainEvents: [ domainEvent ]});

        const { client } = await runAsServer({ app: api });

        const { status, data } = await client({
          method: 'get',
          url: `/v2/last-domain-event?aggregateIdentifier=${JSON.stringify(aggregateIdentifier)}`
        });

        assert.that(status).is.equalTo(200);
        assert.that(data).is.equalTo(domainEvent);
      });

      test('retrieves the latest domain event if multiple were stored.', async (): Promise<void> => {
        const aggregateIdentifier: AggregateIdentifier = {
          name: 'sampleAggregate',
          id: v4()
        };

        const firstDomainEvent = buildDomainEvent({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier,
          name: 'succeeded',
          data: {},
          metadata: {
            revision: 1,
            initiator: { user: { id: 'jane.doe', claims: { sub: 'jane.doe' }}}
          }
        });
        const secondDomainEvent = buildDomainEvent({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier,
          name: 'succeeded',
          data: {},
          metadata: {
            revision: 2,
            initiator: { user: { id: 'jane.doe', claims: { sub: 'jane.doe' }}}
          }
        });

        await domainEventStore.storeDomainEvents({ domainEvents: [ firstDomainEvent, secondDomainEvent ]});

        const { client } = await runAsServer({ app: api });

        const { status, data } = await client({
          method: 'get',
          url: `/v2/last-domain-event?aggregateIdentifier=${JSON.stringify(aggregateIdentifier)}`
        });

        assert.that(status).is.equalTo(200);
        assert.that(data).is.equalTo(secondDomainEvent);
      });

      test('returns 400 if the aggregate identifier is malformed.', async (): Promise<void> => {
        const { client } = await runAsServer({ app: api });

        const { status, data } = await client({
          method: 'get',
          url: '/v2/last-domain-event?aggregateIdentifier={}',
          validateStatus: (): boolean => true
        });

        assert.that(status).is.equalTo(400);
        assert.that(data).is.equalTo({
          code: errors.AggregateIdentifierMalformed.code,
          message: 'Missing required property: name (at requestQuery.aggregateIdentifier.name).'
        });
      });

      test('returns 404 if no domain events exist for the given aggregate identifier.', async (): Promise<void> => {
        const aggregateIdentifier: AggregateIdentifier = {
          name: 'sampleAggregate',
          id: v4()
        };

        const { client } = await runAsServer({ app: api });

        const { status } = await client({
          method: 'get',
          url: `/v2/last-domain-event?aggregateIdentifier=${JSON.stringify(aggregateIdentifier)}`,
          validateStatus: (): boolean => true
        });

        assert.that(status).is.equalTo(404);
      });
    });

    suite('GET /domain-events-by-causation-id', (): void => {
      test('stream ends immediately if no events with a matching causation id exist.', async (): Promise<void> => {
        const domainEvent = buildDomainEvent({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier: {
            name: 'sampleAggregate',
            id: v4()
          },
          name: 'execute',
          data: {},
          id: v4(),
          metadata: {
            causationId: v4(),
            correlationId: v4(),
            revision: 1,
            initiator: { user: { id: 'jane.doe', claims: { sub: 'jane.doe' }}}
          }
        });

        await domainEventStore.storeDomainEvents({ domainEvents: [ domainEvent ]});

        const { client } = await runAsServer({ app: api });
        const { status, data, headers } = await client({
          method: 'get',
          url: `/v2/domain-events-by-causation-id?causation-id=${v4()}`,
          responseType: 'stream'
        });

        assert.that(status).is.equalTo(200);
        assert.that(headers['content-type']).is.equalTo('application/x-ndjson');

        await new Promise<void>((resolve, reject): void => {
          data.on('data', (stuff: any): void => {
            try {
              assert.that(JSON.parse(stuff.toString())).is.equalTo({ name: 'heartbeat' });
            } catch (ex: unknown) {
              reject(ex);
            }
          });
          data.on('error', reject);
          data.on('end', resolve);
        });
      });

      test('returns all domain events with a matching causation id.', async (): Promise<void> => {
        const causationId = v4();

        const domainEvent1 = buildDomainEvent({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier: {
            name: 'sampleAggregate',
            id: v4()
          },
          name: 'execute',
          data: {},
          id: v4(),
          metadata: {
            causationId,
            correlationId: v4(),
            revision: 1,
            initiator: { user: { id: 'jane.doe', claims: { sub: 'jane.doe' }}}
          }
        });
        const domainEvent2 = buildDomainEvent({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier: {
            name: 'sampleAggregate',
            id: v4()
          },
          name: 'execute',
          data: {},
          id: v4(),
          metadata: {
            causationId,
            correlationId: v4(),
            revision: 1,
            initiator: { user: { id: 'jane.doe', claims: { sub: 'jane.doe' }}}
          }
        });
        const domainEvent3 = buildDomainEvent({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier: {
            name: 'sampleAggregate',
            id: v4()
          },
          name: 'execute',
          data: {},
          id: v4(),
          metadata: {
            causationId: v4(),
            correlationId: v4(),
            revision: 1,
            initiator: { user: { id: 'jane.doe', claims: { sub: 'jane.doe' }}}
          }
        });

        await domainEventStore.storeDomainEvents({ domainEvents: [ domainEvent1, domainEvent2, domainEvent3 ]});

        const { client } = await runAsServer({ app: api });
        const { status, data, headers } = await client({
          method: 'get',
          url: `/v2/domain-events-by-causation-id?causation-id=${causationId}`,
          responseType: 'stream'
        });

        assert.that(status).is.equalTo(200);
        assert.that(headers['content-type']).is.equalTo('application/x-ndjson');

        const collector = waitForSignals({ count: 4 });

        data.on('error', async (ex: Error): Promise<void> => {
          await collector.fail(ex);
        });
        data.on('end', async (): Promise<void> => {
          await collector.signal();
        });

        data.pipe(asJsonStream([
          async (heartbeat): Promise<void> => {
            try {
              assert.that(heartbeat).is.equalTo({ name: 'heartbeat' });
              await collector.signal();
            } catch (ex: unknown) {
              await collector.fail(ex);
            }
          },
          async (domainEvent): Promise<void> => {
            try {
              assert.that(domainEvent).is.atLeast({ id: domainEvent1.id });
              await collector.signal();
            } catch (ex: unknown) {
              await collector.fail(ex);
            }
          },
          async (domainEvent): Promise<void> => {
            try {
              assert.that(domainEvent).is.atLeast({ id: domainEvent2.id });
              await collector.signal();
            } catch (ex: unknown) {
              await collector.fail(ex);
            }
          }
        ]));

        await collector.promise;
      });
    });

    suite('GET /has-domain-events-with-causation-id', (): void => {
      test('returns false if no events with a matching causation id exist.', async (): Promise<void> => {
        const domainEvent = buildDomainEvent({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier: {
            name: 'sampleAggregate',
            id: v4()
          },
          name: 'execute',
          data: {},
          id: v4(),
          metadata: {
            causationId: v4(),
            correlationId: v4(),
            revision: 1,
            initiator: { user: { id: 'jane.doe', claims: { sub: 'jane.doe' }}}
          }
        });

        await domainEventStore.storeDomainEvents({ domainEvents: [ domainEvent ]});

        const { client } = await runAsServer({ app: api });
        const { status, data } = await client({
          method: 'get',
          url: `/v2/has-domain-events-with-causation-id?causation-id=${v4()}`
        });

        assert.that(status).is.equalTo(200);
        assert.that(data).is.equalTo({ hasDomainEventsWithCausationId: false });
      });

      test('returns true if events with a matching causation id exist.', async (): Promise<void> => {
        const causationId = v4();

        const domainEvent1 = buildDomainEvent({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier: {
            name: 'sampleAggregate',
            id: v4()
          },
          name: 'execute',
          data: {},
          id: v4(),
          metadata: {
            causationId,
            correlationId: v4(),
            revision: 1,
            initiator: { user: { id: 'jane.doe', claims: { sub: 'jane.doe' }}}
          }
        });
        const domainEvent2 = buildDomainEvent({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier: {
            name: 'sampleAggregate',
            id: v4()
          },
          name: 'execute',
          data: {},
          id: v4(),
          metadata: {
            causationId,
            correlationId: v4(),
            revision: 1,
            initiator: { user: { id: 'jane.doe', claims: { sub: 'jane.doe' }}}
          }
        });
        const domainEvent3 = buildDomainEvent({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier: {
            name: 'sampleAggregate',
            id: v4()
          },
          name: 'execute',
          data: {},
          id: v4(),
          metadata: {
            causationId: v4(),
            correlationId: v4(),
            revision: 1,
            initiator: { user: { id: 'jane.doe', claims: { sub: 'jane.doe' }}}
          }
        });

        await domainEventStore.storeDomainEvents({ domainEvents: [ domainEvent1, domainEvent2, domainEvent3 ]});

        const { client } = await runAsServer({ app: api });
        const { status, data } = await client({
          method: 'get',
          url: `/v2/has-domain-events-with-causation-id?causation-id=${causationId}`
        });

        assert.that(status).is.equalTo(200);
        assert.that(data).is.equalTo({ hasDomainEventsWithCausationId: true });
      });
    });

    suite('GET /domain-events-by-correlation-id', (): void => {
      test('returns an empty array if no events with a matching correlation id exist.', async (): Promise<void> => {
        const domainEvent = buildDomainEvent({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier: {
            name: 'sampleAggregate',
            id: v4()
          },
          name: 'execute',
          data: {},
          id: v4(),
          metadata: {
            causationId: v4(),
            correlationId: v4(),
            revision: 1,
            initiator: { user: { id: 'jane.doe', claims: { sub: 'jane.doe' }}}
          }
        });

        await domainEventStore.storeDomainEvents({ domainEvents: [ domainEvent ]});

        const { client } = await runAsServer({ app: api });
        const { status, data, headers } = await client({
          method: 'get',
          url: `/v2/domain-events-by-correlation-id?correlation-id=${v4()}`,
          responseType: 'stream'
        });

        assert.that(status).is.equalTo(200);
        assert.that(headers['content-type']).is.equalTo('application/x-ndjson');

        await new Promise<void>((resolve, reject): void => {
          data.on('data', (stuff: any): void => {
            try {
              assert.that(JSON.parse(stuff.toString())).is.equalTo({ name: 'heartbeat' });
            } catch (ex: unknown) {
              reject(ex);
            }
          });
          data.on('error', reject);
          data.on('end', resolve);
        });
      });

      test('returns all domain events with a matching correlation id.', async (): Promise<void> => {
        const correlationId = v4();

        const domainEvent1 = buildDomainEvent({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier: {
            name: 'sampleAggregate',
            id: v4()
          },
          name: 'execute',
          data: {},
          id: v4(),
          metadata: {
            causationId: v4(),
            correlationId,
            revision: 1,
            initiator: { user: { id: 'jane.doe', claims: { sub: 'jane.doe' }}}
          }
        });
        const domainEvent2 = buildDomainEvent({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier: {
            name: 'sampleAggregate',
            id: v4()
          },
          name: 'execute',
          data: {},
          id: v4(),
          metadata: {
            causationId: v4(),
            correlationId,
            revision: 1,
            initiator: { user: { id: 'jane.doe', claims: { sub: 'jane.doe' }}}
          }
        });
        const domainEvent3 = buildDomainEvent({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier: {
            name: 'sampleAggregate',
            id: v4()
          },
          name: 'execute',
          data: {},
          id: v4(),
          metadata: {
            causationId: v4(),
            correlationId: v4(),
            revision: 1,
            initiator: { user: { id: 'jane.doe', claims: { sub: 'jane.doe' }}}
          }
        });

        await domainEventStore.storeDomainEvents({ domainEvents: [ domainEvent1, domainEvent2, domainEvent3 ]});

        const { client } = await runAsServer({ app: api });
        const { status, data, headers } = await client({
          method: 'get',
          url: `/v2/domain-events-by-correlation-id?correlation-id=${correlationId}`,
          responseType: 'stream'
        });

        assert.that(status).is.equalTo(200);
        assert.that(headers['content-type']).is.equalTo('application/x-ndjson');

        const collector = waitForSignals({ count: 4 });

        data.on('error', async (ex: Error): Promise<void> => {
          await collector.fail(ex);
        });
        data.on('end', async (): Promise<void> => {
          await collector.signal();
        });

        data.pipe(asJsonStream([
          async (heartbeat): Promise<void> => {
            try {
              assert.that(heartbeat).is.equalTo({ name: 'heartbeat' });
              await collector.signal();
            } catch (ex: unknown) {
              await collector.fail(ex);
            }
          },
          async (domainEvent): Promise<void> => {
            try {
              assert.that(domainEvent).is.atLeast({ id: domainEvent1.id });
              await collector.signal();
            } catch (ex: unknown) {
              await collector.fail(ex);
            }
          },
          async (domainEvent): Promise<void> => {
            try {
              assert.that(domainEvent).is.atLeast({ id: domainEvent2.id });
              await collector.signal();
            } catch (ex: unknown) {
              await collector.fail(ex);
            }
          }
        ]));

        await collector.promise;
      });
    });

    suite('GET /snapshot', (): void => {
      test('retrieves the snapshot for a given aggregate identifier.', async (): Promise<void> => {
        const aggregateIdentifier: AggregateIdentifier = {
          name: 'sampleAggregate',
          id: v4()
        };

        const snapshot: Snapshot<object> = {
          aggregateIdentifier,
          revision: 1,
          state: {}
        };

        await domainEventStore.storeSnapshot({
          snapshot
        });

        const { client } = await runAsServer({ app: api });

        const { status, data } = await client({
          method: 'get',
          url: `/v2/snapshot?aggregateIdentifier=${JSON.stringify(aggregateIdentifier)}`
        });

        assert.that(status).is.equalTo(200);
        assert.that(data).is.equalTo(snapshot);
      });

      test('retrieves the latest snapshot if multiple were stored.', async (): Promise<void> => {
        const aggregateIdentifier: AggregateIdentifier = {
          name: 'sampleAggregate',
          id: v4()
        };

        const firstSnapshot: Snapshot<object> = {
          aggregateIdentifier,
          revision: 1,
          state: {}
        };
        const secondSnapshot: Snapshot<object> = {
          aggregateIdentifier,
          revision: 2,
          state: {}
        };

        await domainEventStore.storeSnapshot({
          snapshot: firstSnapshot
        });
        await domainEventStore.storeSnapshot({
          snapshot: secondSnapshot
        });

        const { client } = await runAsServer({ app: api });

        const { status, data } = await client({
          method: 'get',
          url: `/v2/snapshot?aggregateIdentifier=${JSON.stringify(aggregateIdentifier)}`
        });

        assert.that(status).is.equalTo(200);
        assert.that(data).is.equalTo(secondSnapshot);
      });

      test('returns 400 if the aggregate identifier is malformed.', async (): Promise<void> => {
        const { client } = await runAsServer({ app: api });

        const { status, data } = await client({
          method: 'get',
          url: '/v2/snapshot?aggregateIdentifier={}',
          validateStatus: (): boolean => true
        });

        assert.that(status).is.equalTo(400);
        assert.that(data).is.equalTo('Missing required property: name (at requestQuery.aggregateIdentifier.name).');
      });

      test('returns 404 if no snapshot exists for the given aggregate identifier.', async (): Promise<void> => {
        const aggregateIdentifier: AggregateIdentifier = {
          name: 'sampleAggregate',
          id: v4()
        };

        const { client } = await runAsServer({ app: api });

        const { status } = await client({
          method: 'get',
          url: `/v2/snapshot?aggregateIdentifier=${JSON.stringify(aggregateIdentifier)}`,
          validateStatus: (): boolean => true
        });

        assert.that(status).is.equalTo(404);
      });
    });
  });
});
