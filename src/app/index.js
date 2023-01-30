import fs from 'fs';
import path from 'path';
// fastify
import fastify from 'fastify';
// libs
import ms from 'ms';
import sqlite3 from 'sqlite3';
import * as sqlite from 'sqlite';
// app
import { configValidator } from '../utils/configValidator.js';
// import { bodyFixture } from '../fixtures/fixture.mjs';
import { CronService } from '../libs/CronService.js';
import { GoogleClient } from '../libs/GoogleClient.js';
import {
  buildVideoPath,
  buildDataPath,
  oauthCallbackRoutePath,
} from '../utils/helpers.js';
import * as controller from './controllers.js';

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

  config.OAUTH_REDIRECT_URL = `${config.DOMAIN}:${config.PORT}${oauthCallbackRoutePath}`;

  server.decorate('config', config);

  server.route({
    method: 'GET',
    url: '/',
    handler(req, res) {
      res.code(200).send('Hi!');
    },
  });

  server.route({
    method: 'POST',
    url: '/oauth2',
    handler: controller.reqister,
  });

  server.route({
    method: 'GET',
    url: '/oauth2',
    handler: controller.oauth,
  });

  server.route({
    method: 'GET',
    url: `${oauthCallbackRoutePath}`,
    handler: controller.oauthCallback,
  });

  server.route({
    method: 'POST',
    url: `/${config.ROUTE_UUID}`,
    handler: controller.events,
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

  await db.migrate();

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
          item.data = JSON.parse(item.data);
          return item;
        }));
    },
    update: (params) => {
      const { id, ...fields } = params;
      if (typeof fields.data === 'object') {
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
      params.data = JSON.stringify(params.data);
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
    youtubeClients: generateQB('youtube_clients'),
  };

  server.decorate('storage', storage);

  return db;
};

const initTasks = (server) => [
  // prepareDownloadTask(server),
  // prepareYoutubeTask(server),
].map((task) => new CronService(
  task,
  ms(server.config.CRON_PERIOD),
  ms(server.config.CRON_DELAY),
));

export const app = async (envName) => {
  process.on('unhandledRejection', (err) => {
    console.error(err);
    process.exit(1);
  });

  const config = await configValidator(envName);
  const server = initServer(config);
  const db = await initDatabase(server);
  const cronJobs = initTasks(server);

  const googleClient = new GoogleClient({
    oauthRedirectURL: config.OAUTH_REDIRECT_URL,
    storage: server.storage.youtubeClients,
  });
  server.decorate('googleClient', googleClient);

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
