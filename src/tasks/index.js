/* eslint-disable no-loop-func */
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
          })
          .finally(() => {
            itemsInProcessing.delete(item.id);
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

  return () => {
    if (server.googleClient.client.youtube.isNotClient) {
      return Promise.resolve();
    }

    return server.storage.records
      .read(
        {
          loadFromZoomState: loadStateEnum.success,
          loadToYoutubeState: loadStateEnum.ready,
        },
        { createdAt: 'ASC' },
      )
      .then(async (items) => {
        const filteredItems = items.filter((item) => !itemsInProcessing.has(item.id));
        if (filteredItems.length === 0) {
          return true;
        }
        const client = server.googleClient.youtube;
        let hasQuota = client.checkHasQuota();
        if (!hasQuota) return true;

        await client.getPlayLists();
        let index = 0;

        do {
          const item = filteredItems[index];
          itemsInProcessing.add(item.id);
          const { data } = item;

          if (!fs.existsSync(data.meta.filepath)) {
            item.loadToYoutubeState = loadStateEnum.failed;
            item.loadToYoutubeError = 'File not exists';
            await server.storage.records.update(item)
              .finally(() => {
                itemsInProcessing.delete(item.id);
              });
            index += 1;
            // eslint-disable-next-line no-continue
            continue;
          }
          item.loadToYoutubeLastAction = loadToYoutubeActionEnum.upload;

          hasQuota = client.checkHasQuotaForVideo({ youtubePlaylistTitle: data.meta.youtubePlaylist });

          if (!hasQuota) {
            item.loadToYoutubeError = 'Not enough quota for this video';
            item.loadToYoutubeState = loadStateEnum.ready;
            await server.storage.records.update(item)
              .finally(() => {
                itemsInProcessing.delete(item.id);
              });
            return true;
          }

          // return true;
          await client
            .uploadVideo({
              title: data.meta.youtubeName,
              description: data.meta.youtubeDescription,
              filepath: data.meta.filepath,
            })
            .catch((err) => {
              if (isYoutubeQuotaError(err)) {
                client.setQuotaExceeded();
                item.loadToYoutubeError = err.message;
                item.loadToYoutubeState = loadStateEnum.unfinally;
                hasQuota = false;
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
                // TODO: запись иногда повисает в статусе processing, наверное из-за нескольких клиентов
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
                      client.setQuotaExceeded();
                      item.loadToYoutubeError = err.message;
                      item.loadToYoutubeState = loadStateEnum.unfinally;
                      hasQuota = false;
                      return server.storage.records.update(item);
                    }
                    throw err;
                  });
              }
              return true;
            })
            .finally(() => {
              itemsInProcessing.delete(item.id);
            });
          index += 1;
        } while (index < filteredItems.length && hasQuota);

        return true;
      }).catch((err) => {
        server.log.error(err);
        Sentry.setContext('prepareDownloadTask', err);
        Sentry.captureException(err);
      });
  };
};

// TODO: сделать задачу на удаление файлов

// TODO: нужна таска на обработку видео, залитых на ютуб, но не добавленных в плейлист из-за кончившейся квоты?
