import * as luxon from 'luxon';
import crypto from 'crypto';
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
    message: 'Video topic not parsed or contains stop-words in playlist part',
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
export async function controller(req) {
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
