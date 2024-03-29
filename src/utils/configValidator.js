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
const split = (str, lc = false) => str.split(',').map((x) => (lc ? x.trim().toLowerCase() : x.trim()));

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
  CRON_DELETE_DAYS: yup.number().min(1).required(),
  SENTRY_DSN: yup.string().required(),
  GOOGLE_CLIENT_ID: yup.string().required(),
  GOOGLE_CLIENT_SECRET: yup.string().required(),
  GOOGLE_CHANNEL_ID: yup.string().required(),
  ZOOM_WEBHOOK_SECRET_TOKEN: yup.string().required(),
  ZOOM_SKIP_MINIMAL_DURATION_MINUTES: yup.number().required(),
  ZOOM_SKIP_TOPIC_PLAYLIST_CONTAINS: yup.array()
    .transform((__, topics = '') => split(topics, 'lc'))
    .required(),
  ZOOM_SKIP_USERS_MAILS: yup.array()
    .transform((__, emails = '') => split(emails, 'lc'))
    .required(),
  STORAGE_DIRPATH: yup.string()
    .transform((__, paths = '') => path.resolve(__dirname, ...split(paths)))
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
