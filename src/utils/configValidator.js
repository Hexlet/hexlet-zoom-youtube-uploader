import yup from 'yup';
import path from 'path';
import _ from 'lodash';
import dotenv from 'dotenv';
import { ConfigValidationError } from './errors.js';
import { __dirnameBuild } from './helpers.js';

const __dirname = __dirnameBuild(import.meta.url);
const envsMap = {
  prod: 'production',
  dev: 'development',
  test: 'test',
  invalid: 'invalid',
};

const readFromFile = (configPath) => dotenv.config({
  path: path.resolve(__dirname, '..', configPath),
}).parsed;
const envConfigMap = {
  [envsMap.prod]: readFromFile('.env'),
  [envsMap.dev]: readFromFile('development.env'),
  [envsMap.test]: readFromFile('test.config'),
  [envsMap.invalid]: readFromFile('invalid.config'),
};

const checkEnv = (expected) => ([current], schema) => schema.default(current === expected);

const configSchema = yup.object({
  NODE_ENV: yup.string().oneOf(_.values(envsMap)).required(),
  IS_TEST_ENV: yup.boolean().when('NODE_ENV', checkEnv(envsMap.test)),
  IS_DEV_ENV: yup.boolean().when('NODE_ENV', checkEnv(envsMap.dev)),
  IS_PROD_ENV: yup.boolean().when('NODE_ENV', checkEnv(envsMap.prod)),
  PORT: yup.number().required(),
  HOST: yup.string().required(),
  DOMAIN: yup.string().required(),
  LOG_LEVEL: yup.string().required(),
  ROUTE_UUID: yup.string().required(),
  CRON_PERIOD: yup.string().required(),
  CRON_DELAY: yup.string().required(),
  SENTRY_DSN: yup.string().required(),
  ZOOM_WEBHOOK_SECRET_TOKEN: yup.string().required(),
  ZOOM_SKIP_MINIMAL_DURATION_MINUTES: yup.number().required(),
  ZOOM_SKIP_TOPIC_PLAYLIST_CONTAINS: yup.array()
    .transform((__, topics) => (topics ? topics.split(',').map((x) => x.trim()) : []))
    .required(),
  ZOOM_SKIP_USERS_MAILS: yup.array() // TODO: запретить скачивание видео по емейлам
    .transform((__, emails) => emails.split(',').map((x) => x.trim()))
    .required(),
  STORAGE_DIRPATH: yup.string()
    .transform((__, paths) => path.resolve(__dirname, ...paths.split(',').map((x) => x.trim())))
    .required(),
}).required();

export const configValidator = (envName) => {
  const envExists = _.has(envConfigMap, envName);
  if (!envExists) throw new Error(`Unexpected env "${envName}"`);
  const envConfig = envConfigMap[envName];

  return configSchema
    .validate(envConfig, { abortEarly: false })
    .catch((err) => {
      throw new ConfigValidationError(err);
    });
};
