import fs from 'fs';
import { YoutubeQuotaService } from './YoutubeQuotaService.js';
import { AppError } from '../utils/errors.js';

export class YoutubeClient {
  static isNotClient = false;

  constructor(client, { channelId, lastUpdateDay = null, rest = null }, onQuotaUpdate) {
    console.log('\n', 'YoutubeClient', { channelId, lastUpdateDay, rest }, '\n');
    if (!client) {
      throw new AppError('Empty Google client for Youtube client');
    }
    this.client = client;
    this.channelId = channelId;
    this.playlistIdMap = new Map([]);
    this.onQuotaUpdate = onQuotaUpdate;
    this.quotaService = new YoutubeQuotaService({ lastUpdateDay, rest });
  }

  async init() {
    return this.onQuotaUpdate(this.quotaService.get());
  }

  async getPlayLists() {
    if (this.playlistIdMap.size > 0) {
      return false;
    }

    const loadPlayLists = async (pageToken = undefined) => {
      this.quotaService.pay('playlists.list');
      this.onQuotaUpdate(this.quotaService.get());

      return this.client.playlists
        .list({
          part: ['id', 'snippet'],
          maxResults: 50,
          channelId: this.channelId,
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
    };

    return loadPlayLists();
  }

  async createPlaylist({ title }) {
    this.quotaService.pay('playlists.insert');
    this.onQuotaUpdate(this.quotaService.get());

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
      .then((res) => {
        this.playlistIdMap.set(res.data.snippet.title, res.data.id);
      });
  }

  async addToPlaylist({ title, videoId }) {
    this.quotaService.pay('playlistItems.insert');
    this.onQuotaUpdate(this.quotaService.get());
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
    this.onQuotaUpdate(this.quotaService.get());

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

  setQuotaExceeded() {
    this.quotaService.setExceeded();
    this.onQuotaUpdate(this.quotaService.get());
    return true;
  }
}
