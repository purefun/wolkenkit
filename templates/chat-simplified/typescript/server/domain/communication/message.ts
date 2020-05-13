import {
  Aggregate,
  CommandData,
  CommandHandler,
  DomainEventData,
  DomainEventHandler,
  GetInitialState,
  Schema,
  State
} from 'wolkenkit';

export interface MessageState extends State {
  text: string;
  likes: number;
}

export interface SendData extends CommandData {
  text: string;
}

export interface SentData extends DomainEventData {
  text: string;
}

export interface LikeData extends CommandData {}

export interface LikedData extends DomainEventData {
  likes: number;
}

const message: Aggregate<MessageState> = {
  getInitialState: function () {
    return {
      text: '',
      likes: 0
    };
  } as GetInitialState<MessageState>,

  commandHandlers: {
    send: {
      getSchema () {
        return {
          type: 'object',
          properties: {
            text: { type: 'string' }
          },
          required: [ 'text' ],
          additionalProperties: false
        };
      },

      isAuthorized () {
        return true;
      },

      handle (_state, command, { aggregate, error }) {
        if (!command.data.text) {
          throw new error.CommandRejected('Text is missing.');
        }

        aggregate.publishDomainEvent<SentData>('sent', {
          text: command.data.text
        });
      }
    } as CommandHandler<MessageState, SendData>,

    like: {
      getSchema (): Schema {
        return {
          type: 'object',
          properties: {},
          required: [],
          additionalProperties: false
        };
      },

      isAuthorized (): boolean {
        return true;
      },

      handle (state, _command, { aggregate }): void {
        aggregate.publishDomainEvent<LikedData>('liked', {
          likes: state.likes + 1
        });
      }
    } as CommandHandler<MessageState, LikeData>
  },

  domainEventHandlers: {
    sent: {
      getSchema (): Schema {
        return {
          type: 'object',
          properties: {
            text: { type: 'string' }
          },
          required: [ 'text' ],
          additionalProperties: false
        };
      },

      handle (state, domainEvent): Partial<MessageState> {
        return {
          ...state,
          text: domainEvent.data.text
        };
      },

      isAuthorized (): boolean {
        return true;
      }
    } as DomainEventHandler<MessageState, SentData>,

    liked: {
      getSchema (): Schema {
        return {
          type: 'object',
          properties: {
            likes: { type: 'number' }
          },
          required: [ 'likes' ],
          additionalProperties: false
        };
      },

      handle (state, domainEvent): Partial<MessageState> {
        return {
          ...state,
          likes: domainEvent.data.likes
        };
      },

      isAuthorized (): boolean {
        return true;
      }
    } as DomainEventHandler<MessageState, LikedData>
  }
};

export default message;
