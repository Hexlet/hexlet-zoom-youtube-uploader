import { app as createApp } from '../index.js';
import { routeEnum } from '../utils/helpers.js';

let app;

beforeAll(async () => {
  app = await createApp(process.env.NODE_ENV);
});

afterAll(async () => {
  if (app) {
    app.stop();
  }
});

describe('Positive cases', () => {
  test.each(Object.keys(routeEnum))('Check route "%s"', async (name) => {
    const { method, url } = routeEnum[name];
    const path = `${routeEnum.prefix}/v1${url}`;
    const { statusCode, payload } = await app.server.inject({
      method,
      path,
    });
    expect(statusCode).toBeLessThan(500);
    expect(payload).not.toBeFalsy();

    const body = JSON.parse(payload);
    expect(body).toEqual(expect.objectContaining({
      message: expect.any(String),
      params: expect.any(Object),
    }));
  });
});
