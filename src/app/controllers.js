import { constants } from 'http2';
import * as luxon from 'luxon';
import yup from 'yup';
import {
  topicEnum,
  parseTopic,
  loadStateEnum,
  makeUniqueName,
  buildVideoPath,
  processingStateEnum,
  // bodyFixture,
} from '../utils/helpers.js';

const { DateTime } = luxon;

const googleClientBodySchema = yup.object({
  owner: yup.string().required(),
  client_secret: yup.string().required(),
  client_id: yup.string().required(),
  channel_id: yup.string().required(),
}).required();

export function reqister(req, res) {
  const { body = {} } = req;

  googleClientBodySchema
    .validate(body, { abortEarly: false, stripUnknown: true })
    .then((params) => this.googleClient.save(params).then(() => params))
    .then((params) => {
      const usp = new URLSearchParams();
      usp.append('owner', params.owner);
      res.send({ message: `Send GET-request to /oauth2?${usp.toString()}` });
    })
    .catch((err) => res
      .code(constants.HTTP_STATUS_BAD_REQUEST)
      .send({ message: err.errors ? err.errors.join() : err.message }));
}

export function oauth(req, res) {
  const { query } = req;
  if (!(query && query.owner)) {
    res
      .code(constants.HTTP_STATUS_BAD_REQUEST)
      .send({ message: 'Channel owner required' });
  }

  this.googleClient
    .get(query.owner)
    .then((service) => {
      if (service === null) {
        return res
          .code(constants.HTTP_STATUS_FORBIDDEN)
          .send({ message: 'YouTube client was not registered' });
      }

      return res.redirect(service.oauth.authURL);
    });
}

export function oauthCallback(req, res) {
  if (!req.query || !req.query.code) {
    return res.code(constants.HTTP_STATUS_BAD_REQUEST).send({ message: 'Not found oauth code' });
  }
  if (!req.query.state) {
    return res.code(constants.HTTP_STATUS_BAD_REQUEST).send({ message: 'Not found oauth state' });
  }

  const { owner } = JSON.parse(req.query.state);

  return this.googleClient
    .get(owner)
    .then((service) => {
      if (service === null) {
        return res
          .code(constants.HTTP_STATUS_FORBIDDEN)
          .send({ message: 'YouTube client was not registered' });
      }

      return this.googleClient
        .authorize({
          owner,
          code: req.query.code,
        })
        .then(() => {
          res.code(constants.HTTP_STATUS_OK).send({ message: 'ok' });
        })
        .catch((err) => {
          console.error(err);
          res.code(constants.HTTP_STATUS_BAD_REQUEST).send({ message: err.message });
        });
    });
}

export function events(req, res) {
  const { body, query } = req;
  if (!(query && query.owner)) {
    return res.code(constants.HTTP_STATUS_BAD_REQUEST).send({ message: 'Not found owner' });
  }
  const { owner } = query;
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

  return this.storage.events
    .add({
      owner,
      state,
      data,
    })
    .catch((err) => {
      console.error(err);
      res.code(constants.HTTP_STATUS_BAD_REQUEST).send({ message: err.message });
    })
    .then(({ lastID: eventId } = {}) => {
      const isFailedOperation = (!eventId || (state === processingStateEnum.rejected));
      if (!isFailedOperation) {
        res.code(constants.HTTP_STATUS_OK).send({ message: 'ok' });

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
      }
    });
}
