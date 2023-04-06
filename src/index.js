import fs from 'fs';
import path from 'path';
import { constants } from 'http2';
// fastify
import fastify from 'fastify';
import * as Sentry from '@sentry/node';
import '@sentry/tracing';
// libs
import ms from 'ms';
import sqlite3 from 'sqlite3';
import * as sqlite from 'sqlite';
import _ from 'lodash';
import { ValidationError } from 'yup';
// app
import { configValidator } from './utils/configValidator.js';
import { CronService } from './services/CronService.js';
import { GoogleClient } from './services/GoogleClient.js';
import {
  buildVideoPath,
  buildDataPath,
  routeEnum,
  __dirnameBuild,
} from './utils/helpers.js';
import {
  prepareDownloadTask,
  prepareYoutubeTask,
} from './tasks/index.js';
import * as controller from './controllers/index.js';

const initServer = (config) => {
  const pinoPrettyTransport = {
    transport: {
      target: 'pino-pretty',
    },
  };

  const transport = config.IS_DEV_ENV ? pinoPrettyTransport : {};

  const server = fastify({
    logger: {
      ...transport,
      level: config.LOG_LEVEL,
    },
  });

  Sentry.init({
    dsn: config.SENTRY_DSN,
    tracesSampleRate: 1.0,
    environment: config.NODE_ENV,
  });

  routeEnum.events.url = `/${config.ROUTE_UUID}`;
  config.OAUTH_REDIRECT_URL = `${config.DOMAIN}${routeEnum.oauthCallback.url}`;

  server.decorate('config', config);

  server.setErrorHandler((err, req, res) => {
    server.log.debug(err);
    Sentry.captureException(err);

    const isValidationError = err instanceof ValidationError;
    const message = err.message || 'Unknown error';
    const statusCode = isValidationError
      ? constants.HTTP_STATUS_BAD_REQUEST
      : err.statusCode || constants.HTTP_STATUS_INTERNAL_SERVER_ERROR;
    const params = isValidationError
      ? err.errors
      : err.params || {};

    res.code(statusCode).send({ message, params });
  });

  server.setNotFoundHandler((req, res) => {
    server.log.debug(req);
    res
      .code(constants.HTTP_STATUS_NOT_FOUND)
      .send({
        message: `Route ${req.method} ${req.url} not found`,
        params: {},
      });
  });

  server.route({
    method: routeEnum.main.method,
    url: `${routeEnum.prefix}/v1${routeEnum.main.url}`,
    handler(req, res) {
      res.code(constants.HTTP_STATUS_OK).send({ message: 'Hi!', params: {} });
    },
  });

  server.route({
    method: routeEnum.register.method,
    url: `${routeEnum.prefix}/v1${routeEnum.register.url}`,
    handler(req, res) {
      const data = {
        body: req.body || {},
        query: req.query || {},
      };
      const action = controller.reqister.bind(server);

      return action(data)
        .then((result) => {
          const message = result && result.message ? result.message : result.toString();
          const params = result && result.params ? result.params : {};
          return res.code(constants.HTTP_STATUS_OK).send({ message, params });
        });
    },
  });

  server.route({
    method: routeEnum.oauth.method,
    url: `${routeEnum.prefix}/v1${routeEnum.oauth.url}`,
    handler(req, res) {
      const data = {
        body: req.body || {},
        query: req.query || {},
      };
      const action = controller.oauth.bind(server);

      return action(data)
        .then((authURL) => res.redirect(authURL));
    },
  });

  server.route({
    method: routeEnum.oauthCallback.method,
    url: `${routeEnum.oauthCallback.url}`,
    handler(req, res) {
      const data = {
        body: req.body || {},
        query: req.query || {},
      };
      const action = controller.oauthCallback.bind(server);

      return action(data)
        .then((result) => {
          const message = result && result.message ? result.message : result.toString();
          const params = result && result.params ? result.params : {};
          return res.code(constants.HTTP_STATUS_OK).send({ message, params });
        });
    },
  });

  server.route({
    method: routeEnum.events.method,
    url: `${routeEnum.prefix}/v1${routeEnum.events.url}`,
    handler(req, res) {
      const data = {
        body: req.body || {},
        query: req.query || {},
      };
      const action = controller.events.bind(server);

      return action(data)
        .then(([result, task]) => {
          if (task) {
            task().catch((err) => {
              server.log.error(err);
              Sentry.captureException(err);
            });
          }
          return res.code(constants.HTTP_STATUS_OK).send(result);
        });
    },
  });

  return server;
};

const initDatabase = async (server) => {
  const videoFilepath = buildVideoPath(server.config.STORAGE_DIRPATH);
  const videoDirpath = path.dirname(videoFilepath);
  if (!fs.existsSync(videoDirpath)) {
    fs.mkdirSync(videoDirpath);
  }

  const dbFilepath = buildDataPath(server.config.STORAGE_DIRPATH, 'database', 'db');
  const dbDirpath = path.dirname(dbFilepath);
  if (!fs.existsSync(dbDirpath)) {
    fs.mkdirSync(dbDirpath);
  }

  const db = await sqlite.open({
    filename: dbFilepath,
    driver: server.config.IS_DEV_ENV
      ? sqlite3.verbose().Database
      : sqlite3.Database,
  });

  await db.migrate({
    migrationsPath: path.join(__dirnameBuild(import.meta.url), 'migrations'),
  });

  const generateQB = (tableName) => ({
    read: (where = {}) => {
      const whereKeys = Object.keys(where);
      const hasWhere = whereKeys.length > 0;
      let select = `SELECT * FROM ${tableName}`;

      if (hasWhere) {
        const placeholders = [];
        where = whereKeys.reduce((acc, key) => {
          const placeholder = `:${key}`;
          placeholders.push(`${key}=${placeholder}`);
          acc[placeholder] = where[key];
          return acc;
        }, {});
        select = `${select} WHERE ${placeholders.join(' AND ')}`;
      }

      return db.all(select, where)
        .then((items) => items.map((item) => {
          if (item.data) {
            item.data = JSON.parse(item.data);
          }

          return item;
        }));
    },
    readOne: function readOne(where = {}) {
      return this.read(where).then((results) => results[0]);
    },
    update: (params) => {
      const { id, ...fields } = params;
      if (_.isPlainObject(fields.data)) {
        fields.data = JSON.stringify(fields.data);
      }
      const columns = Object.keys(fields);
      const placeholders = [];
      const insertions = columns.reduce((acc, key) => {
        const value = fields[key];
        if (value === undefined) return acc;

        const placeholder = `:${key}`;
        placeholders.push(`${key}=${placeholder}`);
        acc[placeholder] = value;
        return acc;
      }, {});

      return db.run(
        `UPDATE ${tableName} SET ${placeholders.join(', ')} WHERE id=(${id})`,
        insertions,
      );
    },
    add: (params) => {
      if (_.isPlainObject(params.data)) {
        params.data = JSON.stringify(params.data);
      }
      const columns = Object.keys(params);
      const placeholders = [];
      const insertions = columns.reduce((acc, key) => {
        const placeholder = `:${key}`;
        placeholders.push(placeholder);
        acc[placeholder] = params[key];
        return acc;
      }, {});

      return db.run(
        `INSERT INTO ${tableName} (${columns.join(',')}) VALUES (${placeholders.join(',')})`,
        insertions,
      );
    },
  });

  const storage = {
    events: generateQB('events'),
    records: generateQB('records'),
    youtubeClients: generateQB('google_clients'),
  };

  server.decorate('storage', storage);

  return db;
};

const initTasks = (server) => [
  prepareDownloadTask(server),
  prepareYoutubeTask(server),
].map((task) => new CronService(
  task,
  ms(server.config.CRON_PERIOD),
  ms(server.config.CRON_DELAY),
));

export const app = async (envName) => {
  process.on('unhandledRejection', (err) => {
    if (!envName.toLowerCase().includes('test')) {
      console.error(err);
    }
    process.exit(1);
  });

  const config = await configValidator(envName);
  const server = initServer(config);
  const db = await initDatabase(server);
  const cronJobs = initTasks(server);

  const googleClient = new GoogleClient({
    oauthRedirectURL: config.OAUTH_REDIRECT_URL,
    storage: server.storage.youtubeClients,
    logger: server.log,
  });
  server.decorate('googleClient', googleClient);

  // TODO: выпилить, когда разберусь с обновлением токена и квотами
  // await server.storage.records.read({ loadToYoutubeState: 'failed' })
  //   .then((records) => Promise.all(records
  //     .map((record) => server.storage.records.update({
  //       id: record.id,
  //       loadToYoutubeState: 'ready',
  //       loadToYoutubeError: '',
  //     }))));

  const stop = async () => {
    server.log.info('Stop app', config);
    server.log.info('  Stop cron');
    await Promise.all(cronJobs.map((cronJob) => cronJob.stop()));
    server.log.info('  Stop database');
    await db.close();
    server.log.info('  Stop server');
    await server.close();
    server.log.info('App stopped');

    if (!config.IS_TEST_ENV) {
      process.exit(0);
    }
  };

  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  await server.listen({ port: config.PORT, host: config.HOST });
  await Promise.all(cronJobs.map((cronJob) => cronJob.start()));

  return {
    server,
    config,
    stop,
  };
};
