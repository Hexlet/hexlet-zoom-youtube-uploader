import * as Sentry from '@sentry/node';
import {
  loadStateEnum,
  downloadZoomFile,
} from '../utils/helpers.js';

export const task = (server) => {
  const itemsInProcessing = new Set();

  return () => server.storage.records
    .read(
      [{ field: 'loadFromZoomState', value: loadStateEnum.ready }],
      { createdAt: 'ASC' },
    )
    .then((items) => {
      const loadPromises = items.map((item) => {
        if (itemsInProcessing.has(item.id)) {
          return Promise.resolve();
        }
        itemsInProcessing.add(item.id);

        return downloadZoomFile({
          filepath: item.data.meta.filepath,
          url: item.data.download_url,
          token: item.data.download_token,
        })
          .catch((err) => {
            server.log.error(err);
            Sentry.setContext('task: download. downloadZoomFile', err);
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
      Sentry.setContext('task: download', err);
      Sentry.captureException(err);
    });
};
