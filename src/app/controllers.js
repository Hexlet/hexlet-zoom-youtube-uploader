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
} from '../utils/helpers.js';

const { DateTime } = luxon;

const youtubeClientBodySchema = yup.object({
  channel_owner: yup.string().required(),
  client_secret: yup.string().required(),
  client_id: yup.string().required(),
}).required();

export function reqister(req, res) {
  const { body = {} } = req;

  youtubeClientBodySchema
    .validate(body, { abortEarly: false })
    .then((params) => this.youTubeClient
      .save({
        owner: params.channel_owner,
        client_id: params.client_id,
        client_secret: params.client_secret,
      })
      .then(() => res.redirect('/oauth2')))
    .catch((err) => res
      .code(constants.HTTP_STATUS_BAD_REQUEST)
      .send(err.messages ? err.messages.join() : err.message));
}

export function oauth(req, res) {
  const { query } = req;
  if (!(query && query.channel_owner)) {
    res
      .code(constants.HTTP_STATUS_BAD_REQUEST)
      .send('Channel owner required');
  }

  this.youTubeClient
    .get(query.channel_owner)
    .then((youTubeClient) => {
      if (youTubeClient === null) {
        return res
          .code(constants.HTTP_STATUS_FORBIDDEN)
          .send('YouTube client was not registered');
      }

      return res.redirect(youTubeClient.authURL);
    });
}

export function oauthCallback(req, res) {
  if (!req.query || !req.query.code) {
    return res.code(constants.HTTP_STATUS_BAD_REQUEST).send('Not found oauth code');
  }
  if (!req.query.state) {
    return res.code(constants.HTTP_STATUS_BAD_REQUEST).send('Not found oauth state');
  }

  const state = JSON.parse(req.query.state);

  return this.youTubeClient
    .get(state.channel_owner)
    .then((youTubeClient) => {
      if (youTubeClient === null) {
        return res
          .code(constants.HTTP_STATUS_FORBIDDEN)
          .send('YouTube client was not registered');
      }

      return youTubeClient
        .getToken(req.query.code)
        .then(({ tokens }) => {
          youTubeClient.setCredentials(tokens);
          return this.storage.tokens.set({
            owner: state.channel_owner,
            token: tokens,
          });
        })
        .then(() => {
          res.code(constants.HTTP_STATUS_OK).send('ok');
        })
        .catch((err) => {
          console.error(err);
          res.code(constants.HTTP_STATUS_BAD_REQUEST).send(err.message);
        });
    });
}

export function events(req, res) {
  const { body, query } = req;
  if (!(query && query.owner)) {
    return res.code(constants.HTTP_STATUS_BAD_REQUEST).send('Not found owner');
  }
  // const data = this.config.IS_DEV_ENV ? bodyFixture : body;
  const data = this.config.IS_DEV_ENV ? { payload: { object: { recording_files: [] } } } : body;
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
      owner: query.owner,
      state,
      data,
    })
    .then((db) => {
      res.code(constants.HTTP_STATUS_OK).send('ok');
      return db;
    })
    .catch((err) => {
      console.error(err);
      res.code(constants.HTTP_STATUS_BAD_REQUEST).send(err.message);
    })
    .then(({ lastID: eventId } = {}) => {
      if (!eventId || (state === processingStateEnum.rejected)) return true;

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
            owner: query.owner,
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
    });
}
