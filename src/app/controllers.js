import * as luxon from 'luxon';
import crypto from 'crypto';
import yup from 'yup';
import {
  topicEnum,
  parseTopic,
  loadStateEnum,
  makeUniqueName,
  buildVideoPath,
  processingStateEnum,
  incomingEventEnum,
  // bodyFixture,
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
        message: `Registration complete. Send GET-request to /oauth2?${usp.toString()}`,
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

export async function events(req, sendResponse) {
  const { body, query } = req;
  if (!Object.values(incomingEventEnum).includes(body.event)) {
    throw new BadRequestError('Unknown event type');
  }
  if (!query.owner) {
    throw new BadRequestError('Channel owner required');
  }
  const { owner } = query;

  if (body.event === incomingEventEnum.validation) {
    const hashForValidate = crypto
      .createHmac('sha256', this.config.ZOOM_WEBHOOK_SECRET_TOKEN)
      .update(body.payload.plainToken)
      .digest('hex');

    sendResponse({
      plainToken: body.payload.plainToken,
      encryptedToken: hashForValidate,
    });
    return;
  }

  if (body.event === incomingEventEnum.recording) {
    // const data = this.config.IS_DEV_ENV ? bodyFixture : body;
    const data = body;
    const {
      topic,
      duration,
      recording_files,
      start_time,
      account_id,
    } = data.payload.object;
    const isTooShort = (duration < 5); // если запись менее 5 минут
    const videoRecords = recording_files.filter(({ recording_type, status }) => (
      (recording_type === 'shared_screen_with_speaker_view')
      && (status === 'completed')
    ));
    const notHasVideo = videoRecords.length === 0;
    const state = (notHasVideo || isTooShort)
      ? processingStateEnum.rejected
      : processingStateEnum.ready;

    this.storage.events
      .add({
        owner,
        state,
        data,
      })
      .then(({ lastID: eventId } = {}) => {
        const isFailedOperation = (!eventId || (state === processingStateEnum.rejected));
        if (isFailedOperation) {
          sendResponse({ message: 'Videos is too short or not found', params: {} });
          return;
        }
        sendResponse({ message: 'All done', params: {} });

        const preparedTopic = topic.trim().replace(' ', '');
        const parsedTopic = parseTopic(preparedTopic);

        const makeMeta = () => ({
          isHexletTopic: (parsedTopic.type === topicEnum.hexlet),
          isCollegeTopic: (parsedTopic.type === topicEnum.college),
          date: DateTime.fromISO(start_time).setZone('Europe/Moscow').toFormat('dd.LL.yyyy'),
          topicType: parsedTopic.type,
          topicName: '',
          topicAuthor: '',
          topicPotok: '',
          filename: '',
          filepath: '',
          youtubeDescription: '',
          youtubeName: '',
          youtubePlaylist: '',
          youtubeUrl: '',
          zoomAuthorId: account_id,
        });

        const preparedRecordsPromises = videoRecords.map((record) => {
          const recordMeta = makeMeta();
          record.download_token = data.download_token;

          switch (recordMeta.topicType) {
            case topicEnum.college:
            case topicEnum.hexlet: {
              const {
                theme, tutor, potok,
              } = parsedTopic;
              recordMeta.topicName = makeUniqueName();
              recordMeta.topicAuthor = tutor;
              recordMeta.topicPotok = potok;
              recordMeta.youtubePlaylist = potok;

              recordMeta.youtubeDescription = [
                `* Полное название: ${theme}`,
                `* Дата: ${recordMeta.date}`,
                tutor ? `* Автор: ${tutor}` : '',
                `* Поток: ${potok}`,
                `* Источник id: ${recordMeta.zoomAuthorId}`,
              ].filter((x) => x).join('\n');
              break;
            }
            default: {
              recordMeta.topicName = makeUniqueName();
              recordMeta.youtubePlaylist = 'Other';

              recordMeta.youtubeDescription = [
                `* Полное название: ${preparedTopic}`,
                `* Дата: ${recordMeta.date}`,
                `* Источник id: ${recordMeta.zoomAuthorId}`,
              ].join('\n');
            }
          }

          recordMeta.youtubeName = recordMeta.topicName;
          recordMeta.filename = recordMeta.topicName;
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

        Promise.all(preparedRecordsPromises)
          .then(() => this.storage.events.update({
            id: eventId,
            state: processingStateEnum.processed,
          }));
      });
  }
}
