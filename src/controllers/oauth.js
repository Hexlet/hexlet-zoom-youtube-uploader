import {
  BadRequestError,
} from '../utils/errors.js';

export async function controller(data) {
  const { query } = data;
  if (!query.uuid) {
    throw new BadRequestError('UUID is required');
  }
  if (query.uuid !== this.config.ROUTE_UUID) {
    throw new BadRequestError('Incorrect UUID');
  }

  return this.googleClient.getAuthUrl();
}
