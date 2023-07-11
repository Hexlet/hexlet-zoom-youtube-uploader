/* eslint-disable no-loop-func */
import * as Sentry from '@sentry/node';
import {
  loadStateEnum,
  loadToYoutubeActionEnum,
  isYoutubeQuotaError,
  existsFile,
} from '../utils/helpers.js';

export const task = (server) => {
  const itemsInProcessing = new Set();

  return () => {
    if (server.googleClient.client.youtube.isNotClient) {
      return Promise.resolve();
    }

    return server.storage.records
      .read(
        [
          { field: 'loadFromZoomState', value: loadStateEnum.success },
          { field: 'loadToYoutubeState', value: loadStateEnum.ready },
        ],
        { createdAt: 'ASC' },
      )
      .then(async (items) => {
        const filteredItems = items.filter((item) => !itemsInProcessing.has(item.id));
        if (filteredItems.length === 0) {
          return true;
        }
        const client = server.googleClient.client.youtube;
        let hasQuota = client.checkHasQuota();

        if (!hasQuota) return true;

        await client.getPlayLists()
          .catch((err) => {
            if (isYoutubeQuotaError(err)) {
              client.setQuotaExceeded();
              hasQuota = false;
            } else {
              throw err;
            }
          });

        if (!hasQuota) return true;

        let index = 0;

        do {
          const item = filteredItems[index];
          itemsInProcessing.add(item.id);
          const { data } = item;

          if (!existsFile(data.meta.filepath)) {
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
                    server.log.error(err);
                    Sentry.setContext('task: upload. insertToPlaylist', err);
                    Sentry.captureException(err);
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
      })
      .catch((err) => {
        server.log.error(err);
        Sentry.setContext('task: upload', err);
        Sentry.captureException(err);
      });
  };
};
