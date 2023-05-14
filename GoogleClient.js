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
    return this.getBy({ owner })
      .then((client) => client.oauth.getToken(code))
      .then(({ tokens }) => this.save({ owner, tokens }));
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

    return this.storage.readOne({ owner })
      .then((savedParams) => {
        if (savedParams) {
          return this.storage.update({
            id: savedParams.id,
            ...params,
          }).then(() => savedParams);
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
      client.oauth.on('tokens', (refreshedTokens) => {
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
