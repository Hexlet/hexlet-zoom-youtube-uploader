import * as luxon from 'luxon';
import crypto from 'crypto';
import flat from 'flat';
import yup from 'yup';
import {
  padString,
  parseTopic,
  loadStateEnum,
  makeUniqueName,
  buildVideoPath,
  processingStateEnum,
  incomingEventEnum,
} from '../utils/helpers.js';
import {
  BadRequestError,
} from '../utils/errors.js';

const { DateTime } = luxon;

export async function oauth(data) {
  const { query } = data;
  if (!query.uuid) {
    throw new BadRequestError('UUID is required');
  }
  if (query.uuid !== this.config.ROUTE_UUID) {
    throw new BadRequestError('Incorrect UUID');
  }

  return this.googleClient.getAuthUrl();
}

export async function oauthCallback(data) {
  const { query } = data;
  if (!query.code) {
    throw new BadRequestError('Not found oauth code');
  }
  if (!query.state) {
    throw new BadRequestError('Not found oauth state');
  }

  const { uuid } = JSON.parse(query.state);
  if (uuid !== this.config.ROUTE_UUID) {
    throw new BadRequestError('Incorrect UUID');
  }

  // TODO: дёрнуть роут с некорректным code и посмотреть будет ли исключение и как оно обработается
  return this.googleClient
    .authorize({ code: query.code })
    .then(() => ({ message: 'All done. Close this tab' }));
}

const formatEnum = {
  json: 'json',
  tsv: 'tsv',
};
const handlerByFormat = {
  [formatEnum.json]: (records) => records,
  [formatEnum.tsv]: (records) => {
    if (records.length === 0) return '';
    const headersStartRow = '';
    const rows = [headersStartRow];

    records.forEach((record) => {
      const headers = Object.keys(flat(record));
      const headersRow = headers.join('\t');
      if (headersRow.length > rows[0].length) {
        rows[0] = headersRow;
      }
      const values = Object.values(flat(record));
      const valuesRow = values.join('\t').replace(/\n/gim, '\\n');
      rows.push(valuesRow);
    });

    return rows.join('\n');
  },
};
const dateRangeSchema = yup.string().test(
  'date-range',
  // eslint-disable-next-line no-template-curly-in-string
  'Date "${path}" must be in format yyyy-mm-dd and less then today',
  (value) => {
    try {
      const userDate = DateTime.fromFormat(value, 'yyyy-MM-dd');
      if (userDate.invalid) return false;
      const nowDate = DateTime.now();

      return (userDate.toSQLDate() <= nowDate.toSQLDate());
    } catch (err) {
      return false;
    }
  },
);
const toString = (data, format) => {
  const handlers = {
    [formatEnum.json]: () => JSON.stringify(data, null, 1),
    [formatEnum.tsv]: () => data,
  };
  return handlers[format]();
};
export async function report(params) {
  const { query } = params;
  const querySchema = yup.object({
    format: yup.string().oneOf(Object.values(formatEnum)).default(formatEnum.json),
    asFile: yup.boolean().default(false),
    from: dateRangeSchema.default(DateTime.now().minus({ days: 7 }).toSQLDate()),
    to: dateRangeSchema.default(DateTime.now().toSQLDate()),
  });
  const {
    format,
    asFile,
    from,
    to,
  } = await querySchema
    .validate(query, { abortEarly: false })
    .catch((err) => {
      throw new BadRequestError(err.errors.join('\n'));
    });
  if (from > to) {
    throw new BadRequestError('Date "from" must be less then or equal date "to"');
  }

  return this.storage.events
    .read([
      { field: 'createdAt', operator: '>=', value: from },
      {
        field: 'createdAt',
        operator: '<',
        value: DateTime.fromFormat(to, 'yyyy-MM-dd').plus({ day: 1 }).toSQLDate(),
      },
    ])
    .then((incomingEvents) => this.storage.records
      .read([{
        field: 'eventId',
        operator: 'IN',
        value: incomingEvents.map(({ id }) => id),
      }])
      .then((records) => [incomingEvents, records]))
    .then(([incomingEvents, records]) => {
      const preparedRecords = [];

      incomingEvents.forEach((event) => {
        const { data: eventData, ...eventCommonFields } = event;

        eventCommonFields.meta = {
          topic: eventData.payload.object.topic,
          duration: eventData.payload.object.duration,
          host_email: eventData.payload.object.host_email,
          host_id: eventData.payload.object.host_id,
        };

        const record = records.find(({ eventId }) => eventId === event.id);
        if (record) {
          const { data: recordData, ...recordCommonFields } = record;
          recordCommonFields.meta = recordData.meta;
          preparedRecords.push({ event: eventCommonFields, record: recordCommonFields });
        } else {
          preparedRecords.push({ event: eventCommonFields });
        }
      });

      const rawData = handlerByFormat[format](preparedRecords);
      const data = asFile ? toString(rawData, format) : rawData;
      const description = `${from}_${to}`;

      return [data, asFile, format, description];
    });
}

const skipHandlers = [
  {
    check: (payloadObject, config) => (
      payloadObject.duration < config.ZOOM_SKIP_MINIMAL_DURATION_MINUTES
    ),
    message: 'Video is too short',
  },
  {
    check: (payloadObject, config) => {
      const preparedTopic = payloadObject.topic.trim().replace(' ', '');
      const {
        isParsed,
        playlist,
      } = parseTopic(preparedTopic);
      if (!isParsed) return true;

      return config.ZOOM_SKIP_TOPIC_PLAYLIST_CONTAINS.some((word) => playlist.includes(word));
    },
    message: 'Video topic contains stop-words in playlist part',
  },
  {
    check: (payloadObject, config) => config.ZOOM_SKIP_USERS_MAILS
      .some((email) => email === payloadObject.host_email.trim().toLowerCase()),
    message: 'User excluded for video downloading',
  },
  {
    check: (payloadObject) => {
      const videoRecords = payloadObject.recording_files.filter(({ recording_type, status }) => (
        (recording_type === 'shared_screen_with_speaker_view')
        && (status === 'completed')
      ));
      return (videoRecords.length === 0);
    },
    message: 'Video not found',
  },
];
export async function events(req) {
  const { body } = req;

  if (body.event === incomingEventEnum.validation) {
    const hashForValidate = crypto
      .createHmac('sha256', this.config.ZOOM_WEBHOOK_SECRET_TOKEN)
      .update(body.payload.plainToken)
      .digest('hex');

    return [{
      plainToken: body.payload.plainToken,
      encryptedToken: hashForValidate,
    }, null];
  }

  if (body.event === incomingEventEnum.recording) {
    const data = body;
    const {
      topic,
      recording_files,
      start_time,
      host_id,
    } = data.payload.object;

    const skipReasons = skipHandlers.reduce((acc, { check, message }) => {
      const skip = check(data.payload.object, this.config);
      if (skip) {
        acc.push(message);
      }
      return acc;
    }, []);

    const state = (skipReasons.length > 0)
      ? processingStateEnum.rejected
      : processingStateEnum.ready;

    return this.storage.events
      .add({
        state,
        reason: skipReasons.join(';'),
        data,
      })
      .then(({ lastID: eventId } = {}) => {
        if (!eventId) {
          throw new BadRequestError('Database error on save event');
        }
        if (state === processingStateEnum.rejected) {
          return [{ message: 'Event rejected for processing', params: skipReasons }, null];
        }

        return [
          { message: 'All done', params: {} },
          () => {
            const preparedTopic = topic.trim().replace(' ', '');
            const {
              isParsed,
              theme,
              speaker,
              playlist,
            } = parseTopic(preparedTopic);

            const makeMeta = () => ({
              date: DateTime.fromISO(start_time).setZone('Europe/Moscow').toFormat('dd.LL.yyyy'),
              topicTheme: padString(theme),
              topicSpeaker: speaker,
              topicPlaylist: playlist,
              topicIsParsed: isParsed,
              filename: makeUniqueName(),
              filepath: '',
              youtubeDescription: '',
              youtubeName: '',
              youtubePlaylist: playlist,
              youtubeUrl: '',
              zoomAuthorId: host_id,
            });

            const videoRecords = recording_files.filter(({ recording_type, status }) => (
              (recording_type === 'shared_screen_with_speaker_view')
              && (status === 'completed')
            ));

            const preparedRecordsPromises = videoRecords.map((record) => {
              const recordMeta = makeMeta();
              record.download_token = data.download_token;

              if (recordMeta.topicIsParsed) {
                recordMeta.youtubeDescription = [
                  `* Полное название: ${theme}`,
                  `* Дата: ${recordMeta.date}`,
                  speaker ? `* Спикер: ${speaker}` : '',
                  `* Плейлист: ${playlist}`,
                  `* Источник id: ${recordMeta.zoomAuthorId}`,
                ].filter((x) => x).join('\n');
              } else {
                recordMeta.topicTheme = padString(preparedTopic);
                recordMeta.youtubePlaylist = 'Other';
                recordMeta.youtubeDescription = [
                  `* Полное название: ${preparedTopic}`,
                  `* Дата: ${recordMeta.date}`,
                  `* Источник id: ${recordMeta.zoomAuthorId}`,
                ].join('\n');
              }

              recordMeta.youtubeName = recordMeta.topicTheme;
              recordMeta.filepath = buildVideoPath(
                this.config.STORAGE_DIRPATH,
                recordMeta.filename,
                record.file_extension.toLowerCase(),
              );
              record.meta = recordMeta;

              return this.storage.records
                .add({
                  eventId,
                  loadFromZoomState: loadStateEnum.ready,
                  loadToYoutubeState: loadStateEnum.ready,
                  data: record,
                });
            });

            return Promise.all(preparedRecordsPromises)
              .then(() => this.storage.events.update({
                id: eventId,
                state: processingStateEnum.processed,
              }));
          },
        ];
      });
  }

  throw new BadRequestError('Unknown event type');
}
