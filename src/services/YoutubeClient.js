import fs from 'fs';
import { YoutubeQuotaService } from './YoutubeQuotaService.js';
import { AppError } from '../utils/errors.js';

export class YoutubeClient {
  static isNotClient = false;

  constructor(
    client,
    { channelId, lastUpdateDay = null, rest = null },
    {
      onQuotaUpdate,
      onInit,
      onPlaylistsLoad,
      onPlaylistCreate,
    },
  ) {
    if (!client) {
      throw new AppError('Empty Google client for Youtube client');
    }
    this.client = client;
    this.channelId = channelId;
    this.playlistIdMap = new Map([]);
    this.hooks = {
      onQuotaUpdate,
      onInit,
      onPlaylistsLoad,
      onPlaylistCreate,
    };
    this.quotaService = new YoutubeQuotaService({ lastUpdateDay, rest });
  }

  async init() {
    return this.hooks.onInit()
      .then((playlists) => playlists
        .forEach(({ youtubeId, youtubeTitle }) => this.playlistIdMap.set(youtubeTitle, youtubeId)))
      .then(() => this.hooks.onQuotaUpdate(this.quotaService.get()));
  }

  async getPlayLists() {
    if (this.playlistIdMap.size > 0) {
      return false;
    }

    const loadPlayLists = async (pageToken = undefined) => {
      this.quotaService.pay('playlists.list');
      await this.hooks.onQuotaUpdate(this.quotaService.get());

      return this.client.playlists
        .list({
          part: ['id', 'snippet'],
          maxResults: 50,
          channelId: this.channelId,
          pageToken,
        })
        .then(({ data }) => this.hooks.onPlaylistsLoad(
          data.items
            .map((item) => {
              if (!this.playlistIdMap.has(item.snippet.title)) {
                return {
                  youtubeTitle: item.snippet.title,
                  youtubeId: item.id,
                  data: item.snippet,
                };
              }
              return null;
            })
            .filter((x) => x),
        )
          .then(() => {
            data.items.forEach((item) => {
              this.playlistIdMap.set(item.snippet.title, item.id);
            });
            if (data.nextPageToken) {
              return loadPlayLists(data.nextPageToken);
            }

            return true;
          }));
    };

    return loadPlayLists();
  }

  async createPlaylist({ title }) {
    this.quotaService.pay('playlists.insert');
    await this.hooks.onQuotaUpdate(this.quotaService.get());

    return this.client.playlists
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
      .then(({ data }) => this.hooks.onPlaylistCreate({
        youtubeTitle: data.snippet.title,
        youtubeId: data.id,
        data: data.snippet,
      })
        .then(() => this.playlistIdMap.set(data.snippet.title, data.id)));
  }

  async addToPlaylist({ title, videoId }) {
    this.quotaService.pay('playlistItems.insert');
    await this.hooks.onQuotaUpdate(this.quotaService.get());
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
    return this.getPlayLists()
      .then(() => (
        this.playlistIdMap.has(title)
          ? this.addToPlaylist({ title, videoId })
          : this.createPlaylist({ title })
            .then(() => this.addToPlaylist({ title, videoId }))
      ));
  }

  async uploadVideo({ title, description, filepath }) {
    this.quotaService.pay('videos.insert');
    await this.hooks.onQuotaUpdate(this.quotaService.get());

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

  checkHasQuota() {
    return this.quotaService.check('playlists.list');
  }

  checkHasQuotaForVideo({ youtubePlaylistTitle }) {
    const events = [
      'videos.insert',
      'playlistItems.insert',
    ];
    if (this.playlistIdMap.has(youtubePlaylistTitle)) {
      events.push('playlists.insert');
    }

    return this.quotaService.check(...events);
  }

  async setQuotaExceeded() {
    this.quotaService.setExceeded();
    await this.hooks.onQuotaUpdate(this.quotaService.get());
    return true;
  }
}
