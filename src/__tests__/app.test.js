import { app as createApp } from '../index.js';
import { ConfigValidationError } from '../utils/errors.js';

describe('Positive cases', () => {
  let app;

  test('Run app', async () => {
    app = await createApp(process.env.NODE_ENV).catch((e) => e);
    expect(app).not.toBeInstanceOf(Error);
  });

  test('App exist', () => {
    expect(app).not.toBeFalsy();
    expect(app).toEqual(expect.objectContaining({
      server: expect.any(Object),
      config: expect.any(Object),
      stop: expect.any(Function),
    }));
  });

  test('Stop app', async () => {
    await expect(app.stop()).resolves.not.toThrow();
  });
});

describe('Negative cases', () => {
  test('Run app', async () => {
    await expect(createApp('no config')).rejects.toThrow();
  });

  test('Invalid config', async () => {
    const err = await createApp('invalid').catch((e) => e);
    expect(err).toBeInstanceOf(ConfigValidationError);
    expect(err.message.includes('HOST is a required field')).toBe(true);
  });
});
