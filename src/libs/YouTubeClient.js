import { google } from 'googleapis';

export class YouTubeClient {
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

  async findByOwner(owner) {
    return this.storage.read({ owner })
      .then((params) => (params ? this.build(params) : null))
      .then((oauthClient) => {
        if (!oauthClient) return null;
        this.clientByOwnerMap.set(owner, oauthClient);
        return oauthClient;
      });
  }

  async save({ owner, client_id, client_secret }) {
    return this.storage.read({ owner })
      .then((params) => (params
        ? this.storage.update({
          id: params.id,
          owner,
          client_id,
          client_secret,
        })
        : this.storage.add({ owner, client_id, client_secret })))
      .then((params) => this.build(params))
      .then((oauthClient) => {
        this.clientByOwnerMap.set(owner, oauthClient);
        return oauthClient;
      });
  }

  build({ owner, client_id, client_secret }) {
    const oauthClient = new google.auth.OAuth2(
      client_id,
      client_secret,
      this.config.oauthRedirectURL,
    );

    const authorizationUrl = oauthClient.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/youtube.readonly',
        'https://www.googleapis.com/auth/youtube.upload',
        'https://www.googleapis.com/auth/youtube',
      ],
      include_granted_scopes: true,
    });

    const authURL = new URL(authorizationUrl);
    authURL.searchParams.set('state', JSON.stringify({ channel_owner: owner }));
    oauthClient.prototype.authURL = authURL.toString();

    return oauthClient;
  }
}
