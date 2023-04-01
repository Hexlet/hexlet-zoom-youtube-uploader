import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

export const __dirname = path.dirname(fileURLToPath(import.meta.url));

const arrToEnum = (arr) => Object.freeze(arr.reduce((acc, state) => {
  acc[state] = state;
  return acc;
}, {}));

export const processingStateEnum = arrToEnum(['ready', 'processed', 'rejected']);
export const loadStateEnum = arrToEnum(['ready', 'success', 'failed']);
export const topicEnum = arrToEnum(['other', 'hexlet', 'college']);
export const incomingEventEnum = Object.freeze({
  validation: 'endpoint.url_validation',
  recording: 'recording.completed',
});
export const routeEnum = {
  prefix: '/api',
  main: {
    method: 'GET',
    url: '',
  },
  events: {
    method: 'POST',
    url: '',
  },
  register: {
    method: 'POST',
    url: '/oauth2',
  },
  oauth: {
    method: 'GET',
    url: '/oauth2',
  },
  oauthCallback: {
    method: 'GET',
    url: '/oauth2callback',
  },
};

export const parseTopic = (topic) => {
  const parts = topic.split(';').map((item) => item.trim());
  let type = topicEnum.other;
  if (parts.length < 3) {
    return { type };
  }
  const [theme = '', tutor = '', potok = ''] = parts;
  const potokLC = potok.trim().toLowerCase();
  const isHexletTopic = potokLC.startsWith('potok');
  const isCollegeTopic = potokLC.startsWith('колледж');
  if (!(isHexletTopic || isCollegeTopic)) {
    return { type };
  }

  if (isHexletTopic) {
    type = topicEnum.hexlet;
  } else if (isCollegeTopic) {
    type = topicEnum.college;
  }

  return {
    theme: theme.trim(),
    tutor: tutor.trim(),
    potok: potokLC,
    type,
  };
};

export const padString = (string, maxLength = 50, endSymbol = '…') => {
  if (string.length <= maxLength) {
    return string;
  }
  const stringFinalLength = maxLength - endSymbol.length;
  const paddedString = string.slice(0, stringFinalLength);
  return `${paddedString}${endSymbol}`;
};

export const asyncTimeout = (ms, cb = (() => { })) => {
  let timerId = null;

  return new Promise((resolve) => {
    timerId = setTimeout(() => resolve(cb()), ms);
  })
    .then(() => timerId);
};

export const take = (array, count) => {
  const chunk = array.filter((e, i) => i < count);
  const tail = array.filter((e, i) => i >= count);
  return { chunk, tail };
};

export const toStr = (json) => {
  try {
    return JSON.stringify(json, null, 1);
  } catch (e) {
    return `${e.message}; ${JSON.stringify(e, null, 1)}`;
  }
};

export const makeUniqueName = (() => {
  let i = 0;
  return () => {
    i += 1;
    return `${Date.now()}-${i}`;
  };
})();

export const buildDataPath = (storageDirpath, filename, ext = 'json') => path
  .resolve(storageDirpath, 'data', `${filename}.${ext}`);
export const buildVideoPath = (storageDirpath, filename, ext = 'mp4') => path
  .resolve(storageDirpath, 'videos', `${filename}.${ext}`);
export const writeFile = (filepath, data) => fs.promises.writeFile(filepath, data, 'utf-8');
export const readFile = (filepath) => fs.promises.readFile(filepath, 'utf-8').then((data) => JSON.parse(data));
export const downloadZoomFile = ({ filepath, url, token }) => {
  const file = fs.createWriteStream(filepath);

  return axios
    .get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      responseType: 'stream',
    })
    .then(({ data }) => {
      data.pipe(file);
      return new Promise((res, rej) => {
        file.on('finish', () => {
          res(data);
        });
        file.on('error', (err) => {
          rej(err);
        });
      });
    });
};

export const createChunkLoader = (
  datasets,
  preparePromise,
  fileWriter = () => { },
  params = {},
  chunkLogger = () => { },
) => async () => {
  const defaultParams = {
    chunkSize: 100,
    timeoutMS: 500,
  };
  const { chunkSize, timeoutMS } = { ...defaultParams, ...params };
  const total = datasets.length;
  let all = datasets;
  let count = 0;

  do {
    const { chunk, tail } = take(all, chunkSize);
    const promises = chunk.map(preparePromise);
    await Promise.all(promises).then(fileWriter);
    await asyncTimeout(timeoutMS);
    count += chunk.length;
    all = tail;
    chunkLogger({ count, total });
  } while (all.length > 0);
};

export const bodyFixture = {
  event: 'recording.completed',
  event_ts: 1626230691572,
  payload: {
    account_id: 'AAAAAABBBB',
    object: {
      id: 1234567890,
      uuid: '4444AAAiAAAAAiAiAiiAii==',
      host_id: 'x1yCzABCDEfg23HiJKl4mN',
      account_id: 'x1yCzABCDEfg23HiJKl4mN',
      topic: 'Название активности;Имя Фамилия;potok-1',
      type: 4,
      start_time: '2021-07-13T21:44:51Z',
      timezone: 'America/Los_Angeles',
      host_email: 'jchill@example.com',
      duration: 60,
      password: '132456',
      share_url: 'https://example.com',
      total_size: 3328371,
      recording_count: 2,
      on_prem: false,
      thumbnail_links: [
        'https://example.com/replay/2021/07/25/123456789/E54E639G-37B1-4E1G-0D17-3BAA548DD0CF/GMT20210725-123456_Recording_gallery_widthxheight_tb_width1xheight1.jpg',
      ],
      recording_play_passcode: 'yNYIS408EJygs7rE5vVsJwXIz4-VW7MH',
      recording_files: [
        {
          id: 'ed6c2f27-2ae7-42f4-b3d0-835b493e4fa8',
          meeting_id: '098765ABCD',
          recording_start: '2021-03-23T22:14:57Z',
          recording_end: '2021-03-23T23:15:41Z',
          file_type: 'M4A',
          file_size: 246560,
          file_extension: 'M4A',
          play_url: 'https://example.com/recording/play/Qg75t7xZBtEbAkjdlgbfdngBBBB',
          download_url: 'https://example.com/recording/download/Qg75t7xZBtEbAkjdlgbfdngBBBB',
          status: 'completed',
          recording_type: 'audio_only',
        },
        {
          id: '388ffb46-1541-460d-8447-4624451a1db7',
          meeting_id: '098765ABCD',
          recording_start: '2021-03-23T22:14:57Z',
          recording_end: '2021-03-23T23:15:41Z',
          file_type: 'MP4',
          file_size: 282825,
          file_extension: 'MP4',
          play_url: 'https://example.com/recording/play/Qg75t7xZBtEbAkjdlgbfdngCCCC',
          download_url: 'https://example.com/recording/download/Qg75t7xZBtEbAkjdlgbfdngCCCC',
          status: 'completed',
          recording_type: 'shared_screen_with_speaker_view',
        },
      ],
      participant_audio_files: [
        {
          id: 'ed6c2f27-2ae7-42f4-b3d0-835b493e4fa8',
          recording_start: '2021-03-23T22:14:57Z',
          recording_end: '2021-03-23T23:15:41Z',
          recording_type: 'audio_only',
          file_type: 'M4A',
          file_name: 'MyRecording',
          file_size: 246560,
          file_extension: 'MP4',
          play_url: 'https://example.com/recording/play/Qg75t7xZBtEbAkjdlgbfdngAAAA',
          download_url: 'https://example.com/recording/download/Qg75t7xZBtEbAkjdlgbfdngAAAA',
          status: 'completed',
        },
      ],
    },
  },
  download_token: 'abJhbGciOiJIUzUxMiJ9.eyJpc3MiOiJodHRwczovL2V2ZW50Lnpvb20udXMiLCJhY2NvdW50SWQiOiJNdDZzdjR1MFRBeVBrd2dzTDJseGlBIiwiYXVkIjoiaHR0cHM6Ly9vYXV0aC56b29tLnVzIiwibWlkIjoieFp3SEc0c3BRU2VuekdZWG16dnpiUT09IiwiZXhwIjoxNjI2MTM5NTA3LCJ1c2VySWQiOiJEWUhyZHBqclMzdWFPZjdkUGtrZzh3In0.a6KetiC6BlkDhf1dP4KBGUE1bb2brMeraoD45yhFx0eSSSTFdkHQnsKmlJQ-hdo9Zy-4vQw3rOxlyoHv583JyZ',
};
