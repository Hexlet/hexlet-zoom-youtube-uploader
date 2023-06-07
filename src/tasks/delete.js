import * as luxon from 'luxon';
import * as Sentry from '@sentry/node';
import {
  loadStateEnum,
  deleteFile,
} from '../utils/helpers.js';

const { DateTime } = luxon;

export const task = (server) => () => server.storage.records
  .read(
    [
      { field: 'loadToYoutubeState', value: loadStateEnum.success },
      { field: 'createdAt', operator: '<=', value: DateTime.now().minus({ days: 7 }).toSQLDate() },
      { field: 'isVideoRemoved', operator: '=', value: 0 },
    ],
  )
  .then((rawRecords) => {
    const records = rawRecords.map(({ id, data }) => ({ id, filepath: data.meta.filepath }));
    if (records.length === 0) {
      return Promise.resolve();
    }

    const promises = records.map(({ id, filepath }) => deleteFile(filepath)
      .catch((err) => {
        server.log.error(err);
        Sentry.setContext('task: delete', err);
        Sentry.captureException(err);
      })
      .finally(() => server.storage.records.update({ id, isVideoRemoved: 1 })));

    return Promise.all(promises);
  });
