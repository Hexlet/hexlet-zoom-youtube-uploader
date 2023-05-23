import { google } from 'googleapis';
import { YoutubeClient } from './YoutubeClient.js';

export class GoogleClient {
  constructor({ oauthRedirectURL, storage, logger }) {
    this.config = { oauthRedirectURL };
    this.storage = storage;
    this.logger = logger;
    this.clientByOwnerMap = new Map([]);
  }

  async getBy({ owner }) {
    return this.clientByOwnerMap.has(owner)
      ? this.clientByOwnerMap.get(owner)
      : this.findByOwner(owner);
  }

  async authorize({ owner, code }) {
    console.log('GoogleClient authorize');
    return this.getBy({ owner })
      .then((client) => client.oauth.getToken(code)
        .then(({ tokens }) => ({
          owner: client.owner,
          tokens,
          channel_id: client.channel_id,
          client_id: client.client_id,
          client_secret: client.client_secret,
        })))
      .then((params) => this.save(params));
  }

  // private methods

  async findByOwner(owner) {
    return this.storage.readOne({ owner })
      .then((params) => (params ? this.build(params) : null))
      .then((client) => {
        if (!client) return null;
        this.clientByOwnerMap.set(owner, client);
        return client;
      });
  }

  async save({
    owner,
    client_id,
    channel_id,
    client_secret,
    tokens = null,
  }) {
    const params = {
      owner,
      client_id,
      channel_id,
      client_secret,
      ...(tokens ? { tokens: JSON.stringify(tokens) } : {}),
    };
    console.log('GoogleClient save', params);

    return this.storage.readOne({ owner })
      .then((savedParams) => {
        if (savedParams) {
          const updatedParams = {
            id: savedParams.id,
            ...params,
          };
          return this.storage.update(updatedParams).then(() => updatedParams);
        }

        return this.storage.add(params).then(() => params);
      })
      .then((savedParams) => this.build(savedParams))
      .then((client) => {
        this.clientByOwnerMap.set(owner, client);
        return client;
      });
  }

  build({
    owner,
    client_id,
    channel_id,
    client_secret,
    tokens = null,
  }) {
    const client = {
      oauth: {},
      youtube: { isNotClient: true },
      owner,
      channel_id,
    };
    console.log('GoogleClient build', client, tokens);

    client.oauth = new google.auth.OAuth2(
      client_id,
      client_secret,
      this.config.oauthRedirectURL,
    );

    const authorizationUrl = client.oauth.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/youtube.readonly',
        'https://www.googleapis.com/auth/youtube.upload',
        'https://www.googleapis.com/auth/youtube',
      ],
      include_granted_scopes: true,
      prompt: 'consent',
    });

    const authURL = new URL(authorizationUrl);
    authURL.searchParams.set('state', JSON.stringify({ owner }));
    client.oauth.authURL = authURL.toString();

    if (tokens) {
      console.log('GoogleClient tokens');
      // TODO: обновление токена происходит по запросу. Но кто и когда запрос делает? Вроде должна сама либа, но бывают ошибки токена. Может надо перезаписывать весь объект client?
      client.oauth.on('tokens', (refreshedTokens) => {
        this.logger.debug('refresh tokens');
        this.storage.readOne({ owner }).then((savedParams) => {
          const savedTokens = JSON.parse(savedParams.tokens);
          const combinedTokens = {
            ...savedTokens,
            ...refreshedTokens,
          };

          client.oauth.setCredentials(combinedTokens);
          this.storage.update({
            id: savedParams.id,
            tokens: JSON.stringify(combinedTokens),
          });
          this.logger.debug('tokens refreshed');
        });
      });

      client.oauth.setCredentials(typeof tokens === 'string' ? JSON.parse(tokens) : tokens);

      const youtubeClient = google.youtube({
        version: 'v3',
        auth: client.oauth,
      });

      client.youtube = new YoutubeClient(youtubeClient, channel_id);
    }

    return client;
  }
}
