import { google } from 'googleapis';
import { YoutubeClient } from './YoutubeClient.js';
import { AppError } from '../utils/errors.js';

export class GoogleClient {
  constructor({
    oauthRedirectURL,
    clientId,
    clientSecret,
    channelId,
    secretUUID,
    storage,
  }) {
    this.storage = storage;
    this.config = {
      oauthRedirectURL,
      clientId,
      clientSecret,
      channelId,
      secretUUID,
      googleStorageId: 0,
      youtubeStorageId: 0,
    };
    this.client = {
      oauth: {},
      youtube: { isNotClient: true },
    };
  }

  getAuthUrl() {
    return this.client.oauth.authURL;
  }

  async init() {
    this.client.oauth = new google.auth.OAuth2(
      this.config.clientId,
      this.config.clientSecret,
      this.config.oauthRedirectURL,
    );

    const authorizationUrl = this.client.oauth.generateAuthUrl({
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
    authURL.searchParams.append('state', JSON.stringify({ uuid: this.config.secretUUID }));
    this.client.oauth.authURL = authURL.toString();

    let savedConfigGoogle = await this.storage.readOne({ key: 'google' });
    if (!savedConfigGoogle) {
      savedConfigGoogle = await this.storage.add({ key: 'google', data: {} });
    }
    let savedConfigYoutube = await this.storage.readOne({ key: 'youtube' });
    if (!savedConfigYoutube) {
      savedConfigYoutube = await this.storage.add({ key: 'youtube', data: {} });
    }
    this.config.googleStorageId = savedConfigGoogle.lastID || savedConfigGoogle.id;
    this.config.youtubeStorageId = savedConfigYoutube.lastID || savedConfigYoutube.id;

    return this.buildYoutubeClient();
  }

  async authorize({ code }) {
    return this.client.oauth.getToken(code)
      .then(({ tokens }) => this.storage.update({
        id: this.config.googleStorageId,
        data: { tokens },
      }))
      .then(() => this.buildYoutubeClient());
  }

  async buildYoutubeClient() {
    const savedConfig = await this.storage.readOne({ id: this.config.googleStorageId });
    if (!(savedConfig && savedConfig.data)) {
      throw new AppError('Not found saved tokens');
    }
    const { tokens = null } = savedConfig.data;

    if (tokens) {
      this.client.oauth.on('tokens', (refreshedTokens) => {
        const combinedTokens = {
          ...tokens,
          ...refreshedTokens,
        };

        this.client.oauth.setCredentials(combinedTokens);
        this.storage.update({
          id: this.config.googleStorageId,
          data: { tokens: combinedTokens },
        });
      });

      this.client.oauth.setCredentials(tokens);

      const youtubeClient = google.youtube({
        version: 'v3',
        auth: this.client.oauth,
      });

      const savedConfigYoutube = await this.storage.readOne({ key: 'youtube' });
      this.client.youtube = new YoutubeClient(
        youtubeClient,
        {
          channelId: this.config.channelId,
          ...savedConfigYoutube.data,
        },
        async (quotaParams) => this.storage.update({
          id: this.config.youtubeStorageId,
          data: quotaParams,
        }),
      );
      await this.client.youtube.init();
    }
  }
}
