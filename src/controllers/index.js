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
      duration,
      recording_files,
      start_time,
      account_id,
    } = data.payload.object;
    const isTooShort = (duration < this.config.MINIMAL_DURATION_MINUTES); // если запись менее N минут
    const videoRecords = recording_files.filter(({ recording_type, status }) => (
      (recording_type === 'shared_screen_with_speaker_view')
      && (status === 'completed')
    ));
    const notHasVideo = videoRecords.length === 0;
    const state = (notHasVideo || isTooShort)
      ? processingStateEnum.rejected
      : processingStateEnum.ready;

    return this.storage.events
      .add({
        owner,
        state,
        data,
      })
      .then(({ lastID: eventId } = {}) => {
        const isFailedOperation = (!eventId || (state === processingStateEnum.rejected));
        if (isFailedOperation) {
          return [{ message: 'Videos is too short or not found', params: {} }, null];
        }
        return [
          { message: 'All done', params: {} },
          () => {
            // TODO: придумать белый список или чёрный список для записей, которые не нужно загружать
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
