/* eslint-disable max-classes-per-file */

import { constants } from 'http2';

export class AppError extends Error { }

export class ConfigValidationError extends AppError {
  constructor(validationError) {
    super(validationError.errors.join('\n'));
    this.name = 'Config validation error';
  }
}

export class CronServiceError extends AppError { }

export class HTTPError extends AppError {
  constructor(message, statusCode, params = {}) {
    super(message);
    this.statusCode = statusCode;
    this.params = params;
  }
}

export class BadRequestError extends HTTPError {
  constructor(message, params = {}) {
    super(message, constants.HTTP_STATUS_BAD_REQUEST, params);
  }
}

export class UnauthorizedError extends HTTPError {
  constructor(message, params = {}) {
    super(message, constants.HTTP_STATUS_UNAUTHORIZED, params);
  }
}

export class ForbiddenError extends HTTPError {
  constructor(message, params = {}) {
    super(message, constants.HTTP_STATUS_FORBIDDEN, params);
  }
}
