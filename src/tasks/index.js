import fs from 'fs';
import * as Sentry from '@sentry/node';
import {
  loadStateEnum,
  loadToYoutubeActionEnum,
  downloadZoomFile,
  isYoutubeQuotaError,
} from '../utils/helpers.js';

export const prepareDownloadTask = (server) => {
  const itemsInProcessing = new Set();

  return () => server.storage.records
    .read({ loadFromZoomState: loadStateEnum.ready }, { createdAt: 'ASC' })
    .then((items) => {
      const loadPromises = items.map((item) => {
        if (itemsInProcessing.has(item.id)) {
          return Promise.resolve();
        }
        itemsInProcessing.add(item.id);

        // return Promise.resolve()
        return downloadZoomFile({
          filepath: item.data.meta.filepath,
          url: item.data.download_url,
          token: item.data.download_token,
        })
          .catch((err) => {
            server.log.error(err);
            Sentry.setContext('downloadZoomFile', err);
            Sentry.captureException(err);
            item.loadFromZoomError = err.message;
            item.loadFromZoomState = loadStateEnum.failed;
          })
          .then(() => {
            if (item.loadFromZoomState !== loadStateEnum.failed) {
              item.loadFromZoomState = loadStateEnum.success;
            }
            return server.storage.records.update(item);
          });
      });

      return Promise.all(loadPromises);
    }).catch((err) => {
      server.log.error(err);
      Sentry.setContext('prepareDownloadTask', err);
      Sentry.captureException(err);
    });
};

export const prepareYoutubeTask = (server) => {
  const itemsInProcessing = new Set();

  return () => server.storage.records
    .read(
      {
        loadFromZoomState: loadStateEnum.success,
        loadToYoutubeState: loadStateEnum.ready,
      },
      { createdAt: 'ASC' },
    )
    .then((items) => {
      const filteredItems = items.filter((item) => !itemsInProcessing.has(item.id));
      const clientItemMapPromises = filteredItems.map((item) => server.googleClient
        .getBy({ owner: item.owner })
        .then((googleClient) => {
          const youtubeClient = googleClient.youtube.isNotClient ? null : googleClient.youtube;
          return [youtubeClient, item];
        }));

      return Promise.all(clientItemMapPromises);
    })
    .then((clientItemMap) => {
      const loadPromises = clientItemMap
        .filter(([youtubeClient]) => youtubeClient)
        .map(([client, item]) => {
          itemsInProcessing.add(item.id);
          const { data } = item;

          if (!fs.existsSync(data.meta.filepath)) {
            item.loadToYoutubeState = loadStateEnum.failed;
            item.loadToYoutubeError = 'File not exists';
            return server.storage.records.update(item);
          }
          item.loadToYoutubeLastAction = loadToYoutubeActionEnum.upload;

          // return Promise.resolve();
          /* TODO: Квоты
            Надо учесть ошибку при окончании квоты, чтобы задача не реджектилась.
            Но здесь наверное надо бить на подзадачи, т.к. квота может кончиться
            на этапе добавления в плейлист, когда видео загружено
          */
          return client
            .uploadVideo({
              title: data.meta.youtubeName,
              description: data.meta.youtubeDescription,
              filepath: data.meta.filepath,
            })
            .catch((err) => {
              // server.log.error(err);
              // Sentry.captureException(err);
              // item.loadToYoutubeError = err.message;
              // item.loadToYoutubeState = loadStateEnum.failed;
              server.log.debug({ isYoutubeQuotaError: isYoutubeQuotaError(err) });

              if (isYoutubeQuotaError(err)) {
                item.loadToYoutubeError = err.message;
                item.loadToYoutubeState = loadStateEnum.unfinally;
              } else {
                server.log.error(err);
                Sentry.setContext('uploadVideo', err);
                Sentry.captureException(err);
                item.loadToYoutubeError = err.message;
                item.loadToYoutubeState = loadStateEnum.failed;
              }
            })
            .then((res) => {
              switch (item.loadToYoutubeState) {
                case loadStateEnum.ready: {
                  item.loadToYoutubeState = loadStateEnum.processing;
                  data.meta.youtubeUrl = `https://youtu.be/${res.data.id}`;
                  return server.storage.records.update(item).then(() => res.data.id);
                }
                case loadStateEnum.unfinally: {
                  item.loadToYoutubeState = loadStateEnum.ready;
                  return server.storage.records.update(item).then(() => null);
                }
                default: {
                  return server.storage.records.update(item).then(() => null);
                }
              }
              // if (item.loadToYoutubeState !== loadStateEnum.failed) {
              //   item.loadToYoutubeState = loadStateEnum.success;
              //   data.meta.youtubeUrl = `https://youtu.be/${res.data.id}`;
              //   return server.storage.records.update(item).then(() => res.data.id);
              // }

              // return server.storage.records.update(item);
            })
            .then((videoId) => {
              if (item.loadToYoutubeState === loadStateEnum.processing) {
                item.loadToYoutubeLastAction = loadToYoutubeActionEnum.playlist;
                return client
                  .insertToPlaylist({
                    videoId,
                    title: data.meta.youtubePlaylist,
                  })
                  .then(() => {
                    item.loadToYoutubeError = '';
                    item.loadToYoutubeState = loadStateEnum.success;
                    return server.storage.records.update(item);
                  })
                  .catch((err) => {
                    if (isYoutubeQuotaError(err)) {
                      item.loadToYoutubeError = err.message;
                      item.loadToYoutubeState = loadStateEnum.unfinally;
                      return server.storage.records.update(item);
                    }
                    throw err;
                  });
              }
              return true;
            });
        });

      return Promise.all(loadPromises);
    }).catch((err) => {
      server.log.error(err);
      Sentry.setContext('prepareDownloadTask', err);
      Sentry.captureException(err);
    });
};

// TODO: сделать задачу на удаление файлов

// TODO: нужна таска на обработку видео, залитых на ютуб, но не добавленных в плейлист из-за кончившейся квоты?
