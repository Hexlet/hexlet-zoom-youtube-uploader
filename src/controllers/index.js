import * as luxon from 'luxon';
import crypto from 'crypto';
import yup from 'yup';
import flat from 'flat';
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
  BadRequestError, ForbiddenError,
} from '../utils/errors.js';

const { DateTime } = luxon;

const googleClientBodySchema = yup.object({
  owner: yup.string().required(),
  client_secret: yup.string().required(),
  client_id: yup.string().required(),
  channel_id: yup.string().required(),
}).required();

export async function reqister(data) {
  return googleClientBodySchema
    .validate(data.body, { abortEarly: false, stripUnknown: true })
    .then((params) => this.googleClient.save(params).then(() => params))
    .then((params) => {
      const usp = new URLSearchParams();
      usp.append('owner', params.owner);
      return {
        message: `Registration complete. Go to ${this.config.DOMAIN}/oauth2?${usp.toString()}`,
        params: {
          url: `${this.config.DOMAIN}/oauth2?${usp.toString()}`,
          method: 'GET',
        },
      };
    });
}

export async function oauth(data) {
  const { query } = data;
  if (!query.owner) {
    throw new BadRequestError('Channel owner required');
  }

  return this.googleClient
    .getBy({ owner: query.owner })
    .then((service) => {
      if (service === null) {
        throw new ForbiddenError('YouTube client was not registered');
      }

      return service.oauth.authURL;
    });
}

const formatEnum = {
  json: 'json',
  tsv: 'tsv',
};
const handlerByFormat = {
  [formatEnum.json]: (records) => records,
  [formatEnum.tsv]: (records) => {
    if (records.length === 0) return '';
    const firstRecord = records[0];
    const headers = Object.keys(flat(firstRecord));
    const headersRow = headers.join('\t');
    const rows = [headersRow];

    records.forEach((record) => {
      const values = Object.values(flat(record));
      const valuesRow = values.join('\t').replace(/\n/gim, '\\n');
      rows.push(valuesRow);
    });

    return rows.join('\n');
  },
};
export async function report(params) {
  const { query } = params;
  if (!query.format) {
    query.format = formatEnum.json;
  }
  if (!Object.values(formatEnum).includes(query.format)) {
    throw new BadRequestError('Unknown format for records report');
  }

  return this.storage.records
    .read()
    .then((records) => {
      const preparedRecords = [];
      records.forEach((record) => {
        const { data, ...commonFields } = record;
        commonFields.meta = data.meta;
        preparedRecords.push(commonFields);
      });

      return handlerByFormat[query.format](preparedRecords);
    });
}

export async function oauthCallback(data) {
  const { query } = data;
  if (!query.code) {
    throw new BadRequestError('Not found oauth code');
  }
  if (!query.state) {
    throw new BadRequestError('Not found oauth state');
  }

  const { owner } = JSON.parse(query.state);

  return this.googleClient
    .getBy({ owner })
    .then((service) => {
      if (service === null) {
        throw new ForbiddenError('YouTube client was not registered');
      }

      return this.googleClient
        .authorize({
          owner,
          code: query.code,
        })
        .then(() => ({ message: 'All done. Close this tab' }));
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
  const { body, query } = req;
  if (!query.owner) {
    throw new BadRequestError('Channel owner required');
  }
  const { owner } = query;

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
      account_id,
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
        owner,
        state,
        reason: skipReasons.join(';'),
        data,
      })
      .then(({ lastID: eventId } = {}) => {
        if (!eventId) {
          throw new BadRequestError('Database error on save event');
        }
        if (processingStateEnum.rejected) {
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
              zoomAuthorId: account_id,
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
                  owner,
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
