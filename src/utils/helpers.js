import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

export const __dirnameBuild = (importMetaUrl) => path.dirname(fileURLToPath(importMetaUrl));

const arrToEnum = (arr) => Object.freeze(arr.reduce((acc, state) => {
  acc[state] = state;
  return acc;
}, {}));

export const processingStateEnum = arrToEnum(['ready', 'processed', 'rejected']);
export const loadStateEnum = arrToEnum(['ready', 'processing', 'unfinally', 'success', 'failed']);
export const loadToYoutubeActionEnum = arrToEnum(['upload', 'playlist']);
export const incomingEventEnum = Object.freeze({
  validation: 'endpoint.url_validation',
  recording: 'recording.completed',
});
export const routeEnum = {
  prefix: '/api',
  version: {
    v1: '/v1',
  },
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
  report: {
    method: 'GET',
    url: '/report',
  },
};

export const isYoutubeQuotaError = (err) => err
  && err.errors
  && Array.isArray(err.errors)
  && err.errors.some((meta) => meta.reason === 'quotaExceeded');

export const parseTopic = (topic) => {
  const result = {
    theme: '',
    speaker: '',
    playlist: '',
    isParsed: true,
  };
  const parts = topic.split(';').map((item) => item.trim()).filter((i) => i);
  if (parts.length < 3) {
    return result;
  }

  const [theme = '', speaker = '', playlist = ''] = parts;

  result.theme = theme.trim();
  result.speaker = speaker.trim();
  result.playlist = playlist.trim().toLowerCase();
  result.isParsed = true;

  return result;
};

export const padString = (string, maxLength = 100, endSymbol = '…') => {
  if (string.length <= maxLength) {
    return string;
  }
  const stringFinalLength = maxLength - endSymbol.length;
  const paddedString = string.slice(0, stringFinalLength);
  return `${paddedString}${endSymbol}`; // length === (maxLength include endSymbol)
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
