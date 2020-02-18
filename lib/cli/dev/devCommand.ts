import { buildApplication } from '../../common/application/buildApplication';
import { buntstift } from 'buntstift';
import { Command } from 'command-line-interface';
import { DevOptions } from './DevOptions';
import { errors } from '../../common/errors';
import { getAbsolutePath } from '../../common/utils/path/getAbsolutePath';
import { getApplicationPackageJson } from '../../common/application/getApplicationPackageJson';
import { printFooter } from '../printFooter';
import { processenv } from 'processenv';
import { startProcess } from '../../runtimes/shared/startProcess';
import { validatePort } from './validatePort';

const devCommand = function (): Command<DevOptions> {
  return {
    name: 'dev',
    description: 'Run an application in development mode.',

    optionDefinitions: [
      {
        name: 'port',
        alias: 'p',
        description: 'set the port',
        parameterName: 'port',
        type: 'number',
        isRequired: false,
        defaultValue: 3000,
        validate: validatePort
      },
      {
        name: 'identity-provider-issuer',
        alias: 'i',
        description: 'set the identity provider issuer url',
        parameterName: 'url',
        type: 'string',
        isRequired: false
      },
      {
        name: 'identity-provider-certificate',
        alias: 'c',
        description: 'set the identity provider certificate directory',
        parameterName: 'directory',
        type: 'string',
        isRequired: false
      },
      {
        name: 'debug',
        alias: 'd',
        description: 'enable the debug mode',
        type: 'boolean',
        defaultValue: false,
        isRequired: false
      }
    ],

    async handle ({ options: {
      verbose,
      port,
      'identity-provider-issuer': identityProviderIssuer,
      'identity-provider-certificate': identityProviderCertificate,
      debug
    }}): Promise<void> {
      buntstift.configure(
        buntstift.getConfiguration().
          withVerboseMode(verbose)
      );
      const stopWaiting = buntstift.wait();

      try {
        const healthPort = port + 1;

        const { name, dependencies, devDependencies } =
          await getApplicationPackageJson({ directory: process.cwd() });

        if (!dependencies?.wolkenkit && !devDependencies?.wolkenkit) {
          throw new errors.ApplicationNotFound();
        }

        const identityProviders = [];

        if (identityProviderIssuer && identityProviderCertificate) {
          identityProviders.push({
            issuer: identityProviderIssuer,
            certificate: getAbsolutePath({ path: identityProviderCertificate, cwd: process.cwd() })
          });
        }

        buntstift.verbose(`Compiling the '${name}' application...`);
        await buildApplication({
          applicationDirectory: process.cwd()
        });
        buntstift.verbose(`Compiled the '${name}' application.`);
        if (verbose) {
          buntstift.newLine();
        }

        buntstift.info(`Starting the '${name}' application...`);
        buntstift.info(`To stop the '${name}' application, press <Ctrl>+<C>.`);
        buntstift.newLine();
        buntstift.info(`  API port     ${port}`);
        buntstift.info(`  Health port  ${healthPort}`);
        buntstift.newLine();
        printFooter();
        buntstift.newLine();
        buntstift.line();

        stopWaiting();

        await startProcess({
          runtime: 'singleProcess',
          name: 'main',
          enableDebugMode: debug,
          port,
          env: {
            ...processenv() as NodeJS.ProcessEnv,
            APPLICATION_DIRECTORY: process.cwd(),
            COMMAND_QUEUE_RENEW_INTERVAL: JSON.stringify(5_000),
            CONCURRENT_COMMANDS: JSON.stringify(100),
            CORS_ORIGIN: '*',
            DOMAIN_EVENT_STORE_OPTIONS: JSON.stringify({}),
            DOMAIN_EVENT_STORE_TYPE: 'InMemory',
            HEALTH_PORT: JSON.stringify(healthPort),
            IDENTITY_PROVIDERS: JSON.stringify(identityProviders),
            LOCK_STORE_OPTIONS: JSON.stringify({}),
            LOCK_STORE_TYPE: 'InMemory',
            LOG_LEVEL: 'debug',
            PORT: JSON.stringify(port),
            SNAPSHOT_STRATEGY: JSON.stringify({
              name: 'revision',
              configuration: {
                revisionLimit: 100
              }
            })
          },
          onExit (exitCode): void {
            // eslint-disable-next-line unicorn/no-process-exit
            process.exit(exitCode);
          }
        });
      } catch (ex) {
        buntstift.error('Failed to run the application.');

        throw ex;
      } finally {
        stopWaiting();
      }
    }
  };
};

export { devCommand };
