/* eslint-disable max-classes-per-file */

import fs from 'fs';
import { google } from 'googleapis';
import { AppError } from '../utils/errors.js';

class YoutubeClient {
  static isNotClient = false;

  constructor(client) {
    if (!client) {
      throw new AppError('Empty Google client for Youtube client');
    }
    this.client = client;
    this.playlistIdMap = new Map([]);
  }

  async getPlayLists() {
    if (this.playlistIdMap.size > 0) {
      return this.playlistIdMap;
    }

    const loadPlayLists = (pageToken = undefined) => this.client.playlists
      .list({
        part: ['id', 'snippet'],
        maxResults: 50,
        channelId: this.client.channelId,
        pageToken,
      })
      .then((res) => {
        res.data.items.forEach((item) => {
          this.playlistIdMap.set(item.snippet.title, item.id);
        });
        if (res.data.nextPageToken) {
          return loadPlayLists(res.data.nextPageToken);
        }

        return true;
      });

    return loadPlayLists();
  }

  async createPlaylist({ title }) {
    return this.clientyt.playlists
      .insert({
        part: ['id', 'snippet', 'status'],
        requestBody: {
          snippet: {
            title,
          },
          status: {
            privacyStatus: 'unlisted',
          },
        },
      })
      .then((res) => {
        this.playlistIdMap.set(res.data.snippet.title, res.data.id);
      });
  }

  async addToPlaylist({ title, videoId }) {
    const playlistId = this.playlistIdMap.get(title);

    return this.client.playlistItems
      .insert({
        part: ['id', 'snippet'],
        requestBody: {
          snippet: {
            playlistId,
            resourceId: {
              kind: 'youtube#video',
              videoId,
            },
          },
        },
      });
  }

  async insertToPlaylist({ title, videoId }) {
    return this.playlistIdMap.has(title)
      ? this.addToPlaylist({ title, videoId })
      : this.createPlaylist({ title })
        .then(() => this.addToPlaylist({ title, videoId }));
  }

  async uploadVideo({ title, description, filepath }) {
    return this.client.videos
      .insert({
        part: ['id', 'snippet', 'contentDetails', 'status'],
        notifySubscribers: false,
        requestBody: {
          snippet: {
            title,
            description,
          },
          status: {
            privacyStatus: 'unlisted',
          },
        },
        media: {
          body: fs.createReadStream(filepath),
        },
      });
  }
}

export class GoogleClient {
  constructor({ oauthRedirectURL, storage }) {
    this.config = { oauthRedirectURL };
    this.storage = storage;
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
    });

    const authURL = new URL(authorizationUrl);
    authURL.searchParams.set('state', JSON.stringify({ owner }));
    client.oauth.authURL = authURL.toString();

    if (tokens) {
      client.oauth.setCredentials(typeof tokens === 'string' ? JSON.parse(tokens) : tokens);

      const youtubeClient = google.youtube({
        version: 'v3',
        auth: client.oauth,
      });

      youtubeClient.channelId = channel_id;

      client.youtube = new YoutubeClient(youtubeClient);
    }

    return client;
  }
}
