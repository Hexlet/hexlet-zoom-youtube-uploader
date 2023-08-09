import fs from 'fs';
import path from 'path';
// fastify
import fastify from 'fastify';
import * as Sentry from '@sentry/node';
import '@sentry/tracing';
// libs
import sqlite3 from 'sqlite3';
import * as sqlite from 'sqlite';
import _ from 'lodash';
// app
import { configValidator } from './utils/configValidator.js';
import { GoogleClient } from './services/GoogleClient.js';
import {
  buildVideoPath,
  buildDataPath,
  routeEnum,
  __dirnameBuild,
} from './utils/helpers.js';
import { initTasks } from './tasks/index.js';
import { attachRouting } from './controllers/index.js';

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
    disableRequestLogging: true,
  });

  Sentry.init({
    dsn: config.SENTRY_DSN,
    tracesSampleRate: 1.0,
    environment: config.NODE_ENV,
  });

  server.decorate('config', config);

  attachRouting(server);

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

  // TODO: заменить кастомный query builder на ORM или другой нормальный QB
  const generateQB = (tableName) => ({
    read: (where = [], sortBy = {}, limit = 0) => {
      let select = `SELECT * FROM ${tableName}`;

      if (_.isArray(where) && where.length > 0) {
        const placeholders = [];
        where = where.reduce((acc, { field, value, operator = '=' }, i) => {
          if (operator === 'IN') {
            const placeholder = `(${'?'.repeat(value.length).split('').join(',')})`;
            placeholders.push(`${field} ${operator} ${placeholder}`);
            acc.names = value;
            return acc;
          }
          const placeholder = `:${field}${i}`;
          placeholders.push(`${field}${operator}${placeholder}`);
          acc[placeholder] = value;
          return acc;
        }, {});
        select = `${select} WHERE ${placeholders.join(' AND ')}`;
      }

      const sortKeys = Object.keys(sortBy);
      const hasSorts = sortKeys.length > 0;
      if (hasSorts) {
        const sorts = sortKeys.reduce((acc, key) => {
          const sort = `${key} ${sortBy[key]}`;
          acc.push(sort);
          return acc;
        }, []);
        select = `${select} ORDER BY ${sorts.join(', ')}`;
      }

      if (limit > 0) {
        select = `${select} LIMIT ${limit}`;
      }

      return db.all(select, where.names ? where.names : where)
        .then((items) => items.map((item) => {
          if (item.data) {
            item.data = JSON.parse(item.data);
          }

          return item;
        }));
    },
    readOne: function readOne(where = [], sortBy = {}) {
      return this.read(where, sortBy, 1).then(([item]) => item);
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
    playlists: generateQB('playlists'),
    extra: generateQB('extra'),
  };

  server.decorate('storage', storage);

  return db;
};

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

  const googleClient = new GoogleClient({
    oauthRedirectURL: `${config.DOMAIN}${routeEnum.oauthCallback.url}`,
    clientId: config.GOOGLE_CLIENT_ID,
    clientSecret: config.GOOGLE_CLIENT_SECRET,
    channelId: config.GOOGLE_CHANNEL_ID,
    secretUUID: config.ROUTE_UUID,
    storage: server.storage,
  });
  await googleClient.init();
  server.decorate('googleClient', googleClient);

  const cronJobs = initTasks(server);

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
