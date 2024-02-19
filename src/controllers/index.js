import { constants } from 'http2';
import fs from 'fs';
import path from 'path';
// libs
import * as Sentry from '@sentry/node';
import { ValidationError } from 'yup';
// helpers
import { routeEnum, __dirnameBuild } from '../utils/helpers.js';
// controllers
import * as events from './events.js';
import * as oauth from './oauth.js';
import * as oauthCallback from './oauthCallback.js';
import * as report from './report.js';

export const attachRouting = (server) => {
  routeEnum.events.url = `/${server.config.ROUTE_UUID}`;

  server.setErrorHandler((err, req, res) => {
    server.log.debug(err);
    Sentry.setContext('global error handler', err);
    Sentry.captureException(err);

    const isValidationError = err instanceof ValidationError;
    const message = err.message || 'Unknown error';
    const statusCode = isValidationError
      ? constants.HTTP_STATUS_BAD_REQUEST
      : err.statusCode || constants.HTTP_STATUS_INTERNAL_SERVER_ERROR;
    const params = isValidationError
      ? err.errors
      : err.params || {};

    res.code(statusCode).send({ message, params });
  });

  server.setNotFoundHandler((req, res) => {
    res
      .code(constants.HTTP_STATUS_NOT_FOUND)
      .send({
        message: `Route ${req.method} ${req.url} not found`,
        params: {},
      });
  });

  server.route({
    method: 'GET',
    url: '/',
    handler(req, res) {
      const __dirname = __dirnameBuild(import.meta.url);
      const mainPage = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');

      res
        .code(constants.HTTP_STATUS_OK)
        .headers({
          'Content-Type': 'text/html; charset=utf8',
        })
        .send(mainPage);
    },
  });

  server.route({
    method: 'GET',
    url: '/privacy',
    handler(req, res) {
      const __dirname = __dirnameBuild(import.meta.url);
      const privacyPage = fs.readFileSync(path.join(__dirname, 'privacy.html'), 'utf-8');

      res
        .code(constants.HTTP_STATUS_OK)
        .headers({
          'Content-Type': 'text/html; charset=utf8',
        })
        .send(privacyPage);
    },
  });

  server.route({
    method: routeEnum.main.method,
    url: `${routeEnum.prefix}${routeEnum.version.v1}${routeEnum.main.url}`,
    handler(req, res) {
      res.code(constants.HTTP_STATUS_OK).send({ message: 'Hi!', params: {} });
    },
  });

  server.route({
    method: routeEnum.oauth.method,
    url: `${routeEnum.prefix}${routeEnum.version.v1}${routeEnum.oauth.url}`,
    handler(req, res) {
      const data = {
        body: req.body || {},
        query: req.query || {},
      };
      const action = oauth.controller.bind(server);

      return action(data)
        .then((authURL) => res.redirect(authURL));
    },
  });

  server.route({
    method: routeEnum.oauthCallback.method,
    url: `${routeEnum.oauthCallback.url}`,
    handler(req, res) {
      const data = {
        body: req.body || {},
        query: req.query || {},
      };
      const action = oauthCallback.controller.bind(server);

      return action(data)
        .then((result) => {
          const message = result && result.message ? result.message : result.toString();
          const params = result && result.params ? result.params : {};
          return res.code(constants.HTTP_STATUS_OK).send({ message, params });
        });
    },
  });

  server.route({
    method: routeEnum.events.method,
    url: `${routeEnum.prefix}${routeEnum.version.v1}${routeEnum.events.url}`,
    handler(req, res) {
      const data = {
        body: req.body || {},
        query: req.query || {},
      };
      const action = events.controller.bind(server);

      return action(data)
        .then(([result, task]) => {
          if (task) {
            task().catch((err) => {
              server.log.error(err);
              Sentry.setContext('task on route events', err);
              Sentry.captureException(err);
            });
          }
          return res.code(constants.HTTP_STATUS_OK).send(result);
        });
    },
  });

  server.route({
    method: routeEnum.report.method,
    url: `${routeEnum.prefix}${routeEnum.version.v1}${routeEnum.report.url}${routeEnum.events.url}`,
    handler(req, res) {
      const data = {
        query: req.query || {},
      };
      const action = report.controller.bind(server);

      return action(data)
        .then(([result, asFile, format, description]) => {
          if (asFile) {
            const filename = `ZoomYoutubeReport_${description}.${format}`;

            return res
              .code(constants.HTTP_STATUS_OK)
              .headers({
                'Content-Type': 'text/plain; charset=utf8',
                'Content-Disposition': `attachment; name="${description}"; filename="${filename}"`,
              })
              .send(result);
          }
          return res
            .code(constants.HTTP_STATUS_OK)
            .send(asFile ? result : { message: result, params: { format, description } });
        });
    },
  });
};
