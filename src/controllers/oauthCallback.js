import {
  BadRequestError,
} from '../utils/errors.js';

export async function controller(data) {
  const { query } = data;
  if (!query.code) {
    throw new BadRequestError('Not found oauth code');
  }
  if (!query.state) {
    throw new BadRequestError('Not found oauth state');
  }

  const { uuid } = JSON.parse(query.state);
  if (uuid !== this.config.ROUTE_UUID) {
    throw new BadRequestError('Incorrect UUID');
  }

  return this.googleClient
    .authorize({ code: query.code })
    .then(() => ({ message: 'All done. Close this tab' }));
}
