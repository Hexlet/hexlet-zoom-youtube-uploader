import { google } from 'googleapis';

export class GoogleClient {
  constructor({ oauthRedirectURL, storage }) {
    this.config = { oauthRedirectURL };
    this.storage = storage;
    this.clientByOwnerMap = new Map([]);
  }

  async get(owner) {
    return this.clientByOwnerMap.has(owner)
      ? this.clientByOwnerMap.get(owner)
      : this.findByOwner(owner);
  }

  async authorize({ owner, code }) {
    return this.get(owner)
      .then((client) => client.oauth.getToken(code))
      .then(({ tokens }) => this.save({ owner, tokens }));
  }

  // TODO: перенести сюда getPlayLists и другие методы

  // private methods

  async findByOwner(owner) {
    return this.storage.read({ owner })
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

    return this.storage.read({ owner })
      .then((savedParams) => (savedParams
        ? this.storage.update({
          id: savedParams.id,
          ...params,
        })
        : this.storage.add(params)))
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
    });

    const authURL = new URL(authorizationUrl);
    authURL.searchParams.set('state', JSON.stringify({ owner }));
    client.oauth.prototype.authURL = authURL.toString();

    if (tokens) {
      client.oauth.setCredentials(typeof tokens === 'string' ? JSON.parse(tokens) : tokens);

      client.youtube = google.youtube({
        version: 'v3',
        auth: client.oauth,
      });
    }

    return client;
  }
}
