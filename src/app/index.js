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
import { YouTubeClient } from '../libs/YouTubeClient.js';
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
        const placeholder = `:${key}`;
        placeholders.push(`${key}=${placeholder}`);
        acc[placeholder] = fields[key];
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

  const tokens = {
    get: () => db.get('SELECT * FROM tokens').then(({ token }) => JSON.parse(token)),
    set: (params) => {
      const { id: whereId, owner, ...fields } = params;
      const columns = Object.keys(fields);
      const placeholders = [];
      if (typeof fields.token === 'object') {
        fields.token = JSON.stringify(fields.token);
      }

      const updateById = (recordId) => {
        const insertions = columns.reduce((acc, key) => {
          const placeholder = `:${key}`;
          placeholders.push(`${key}=${placeholder}`);
          acc[placeholder] = fields[key];
          return acc;
        }, {});

        return db.run(
          `UPDATE tokens SET ${placeholders.join(', ')} WHERE id=(${recordId})`,
          insertions,
        );
      };

      if (whereId) {
        return updateById(whereId);
      }
      return db
        .get('SELECT id FROM tokens WHERE owner=:owner', {
          ':owner': owner,
        })
        .then((result) => result || {})
        .then(({ id }) => {
          if (id) {
            return updateById(id);
          }
          fields.owner = owner;
          const insertions = columns.reduce((acc, key) => {
            const placeholder = `:${key}`;
            placeholders.push(placeholder);
            acc[placeholder] = fields[key];
            return acc;
          }, {});

          return db.run(
            `INSERT INTO tokens (${columns.join(',')}) VALUES (${placeholders.join(',')})`,
            insertions,
          );
        });
    },
  };

  const storage = {
    events: generateQB('events'),
    records: generateQB('records'),
    youtubeClients: generateQB('youtube_clients'),
    tokens,
  };

  server.decorate('storage', storage);

  return db;
};
// eslint-disable-next-line
const prepareDownloadTask = (server) => {
  // const itemsInProcessing = new Set();
  //
  // return () => server.storage.records
  //   .read({ loadFromZoomState: loadStateEnum.ready })
  //   .then((items) => {
  //     const loadPromises = items.map((item) => {
  //       if (itemsInProcessing.has(item.id)) {
  //         return Promise.resolve();
  //       }
  //       itemsInProcessing.add(item.id);
  //
  //       return Promise.resolve()
  //       // return downloadZoomFile({
  //       //   filepath: item.data.meta.filepath,
  //       //   url: item.data.download_url,
  //       //   token: item.data.download_token,
  //       // })
  //         .catch((err) => {
  //           console.error(err);
  //           item.loadFromZoomError = err.message;
  //           item.loadFromZoomState = loadStateEnum.failed;
  //         })
  //         .then(() => {
  //           if (item.loadFromZoomState !== loadStateEnum.failed) {
  //             item.loadFromZoomState = loadStateEnum.success;
  //           }
  //           return server.storage.records.update(item);
  //         });
  //     });
  //
  //     return Promise.all(loadPromises);
  //   });
};
// eslint-disable-next-line
const prepareYoutubeTask = (server) => {
  // TODO: написать выбор клиента в зависимости от владельца файла
  // const itemsInProcessing = new Set();
  // let oauthClientInitialized = false;
  // const youtubeServices = new Map();
  // const playlistIdMap = new Map();
  //
  // const getPlayLists = (yt, pageToken = undefined) => yt.playlists
  //   .list({
  //     part: ['id', 'snippet'],
  //     maxResults: 50,
  //     channelId: 'UCWVUbtI0-qFejcMFacA9nrA',
  //     pageToken,
  //   })
  //   .then((res) => {
  //     res.data.items.forEach((item) => {
  //       playlistIdMap.set(item.snippet.title, item.id);
  //     });
  //     if (res.data.nextPageToken) {
  //       return getPlayLists(res.data.nextPageToken);
  //     }
  //
  //     return true;
  //   });
  //
  // const createPlaylist = (yt, title) => yt.playlists
  //   .insert({
  //     part: ['id', 'snippet', 'status'],
  //     requestBody: {
  //       snippet: {
  //         title,
  //       },
  //       status: {
  //         privacyStatus: 'unlisted',
  //       },
  //     },
  //   })
  //   .then((res) => {
  //     playlistIdMap.set(res.data.snippet.title, res.data.id);
  //   });
  //
  // const addToPlaylist = (yt, { youtubePlaylist, videoId }) => {
  //   const playlistId = playlistIdMap.get(youtubePlaylist);
  //
  //   return yt.playlistItems
  //     .insert({
  //       part: ['id', 'snippet'],
  //       requestBody: {
  //         snippet: {
  //           playlistId,
  //           resourceId: {
  //             kind: 'youtube#video',
  //             videoId,
  //           },
  //         },
  //       },
  //     });
  // };
  //
  // const insertToPlaylist = (youtubeService, { youtubePlaylist, videoId }) => (playlistIdMap.has(youtubePlaylist)
  //   ? addToPlaylist(youtubeService, { youtubePlaylist, videoId })
  //   : createPlaylist(youtubeService, youtubePlaylist)
  //     .then(() => addToPlaylist(youtubeService, { youtubePlaylist, videoId })));
  //
  // return () => {
  //   if (!oauthClientInitialized) {
  //     return server.storage.tokens.get()
  //       .then((tokens) => {
  //         const isEmpty = Object.keys(tokens).length === 0;
  //         if (!isEmpty) {
  //           server.oauthClient.setCredentials(tokens);
  //
  //           youtubeService = google.youtube({
  //             version: 'v3',
  //             auth: server.oauthClient,
  //           });
  //
  //           oauthClientInitialized = true;
  //
  //           return getPlayLists();
  //         }
  //
  //         return true;
  //       });
  //   }
  //
  //   return server.storage.records
  //     .read({
  //       loadFromZoomState: loadStateEnum.success,
  //       loadToYoutubeState: loadStateEnum.ready,
  //     })
  //     .then((items) => {
  //       const loadPromises = items.map((item) => {
  //         if (itemsInProcessing.has(item.id)) {
  //           return Promise.resolve();
  //         }
  //         itemsInProcessing.add(item.id);
  //         const { data } = item;
  //
  //         if (!fs.existsSync(data.meta.filepath)) {
  //           item.loadToYoutubeState = loadStateEnum.failed;
  //           item.loadToYoutubeError = 'File not exists';
  //           return server.storage.records.update(item);
  //         }
  //
  //         return youtubeService.videos
  //           .insert({
  //             part: ['id', 'snippet', 'contentDetails', 'status'],
  //             notifySubscribers: false,
  //             requestBody: {
  //               snippet: {
  //                 title: data.meta.youtubeName,
  //                 description: data.meta.youtubeDescription,
  //               },
  //               status: {
  //                 privacyStatus: 'unlisted',
  //               },
  //             },
  //             media: {
  //               body: fs.createReadStream(data.meta.filepath),
  //             },
  //           })
  //           .catch((err) => {
  //             console.error(err);
  //             item.loadToYoutubeError = err.message;
  //             item.loadToYoutubeState = loadStateEnum.failed;
  //           })
  //           .then((res) => {
  //             if (item.loadToYoutubeState !== loadStateEnum.failed) {
  //               item.loadToYoutubeState = loadStateEnum.success;
  //               data.meta.youtubeUrl = `https://youtu.be/${res.data.id}`;
  //             }
  //             return server.storage.records.update(item)
  //               .then(() => res.data.id);
  //           })
  //           .then((videoId) => {
  //             if (item.loadToYoutubeState !== loadStateEnum.failed) {
  //               return insertToPlaylist({
  //                 videoId,
  //                 youtubePlaylist: data.meta.youtubePlaylist,
  //               });
  //             }
  //             return true;
  //           });
  //       });
  //
  //       return Promise.all(loadPromises);
  //     });
  // };
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

  const youTubeClient = new YouTubeClient({
    oauthRedirectURL: config.OAUTH_REDIRECT_URL,
    storage: server.storage.youtubeClients,
  });
  server.decorate('youTubeClient', youTubeClient);

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
