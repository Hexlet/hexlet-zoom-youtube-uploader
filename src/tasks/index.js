import fs from 'fs';
import {
  loadStateEnum,
  downloadZoomFile,
} from '../utils/helpers.js';

export const prepareDownloadTask = (server) => {
  const itemsInProcessing = new Set();

  return () => server.storage.records
    .read({ loadFromZoomState: loadStateEnum.ready })
    .then((items) => {
      const loadPromises = items.map((item) => {
        if (itemsInProcessing.has(item.id)) {
          return Promise.resolve();
        }
        itemsInProcessing.add(item.id);

        // return Promise.resolve()
        return downloadZoomFile({
          filepath: item.data.meta.filepath,
          url: item.data.download_url,
          token: item.data.download_token,
        })
          .catch((err) => {
            console.error(err);
            item.loadFromZoomError = err.message;
            item.loadFromZoomState = loadStateEnum.failed;
          })
          .then(() => {
            if (item.loadFromZoomState !== loadStateEnum.failed) {
              item.loadFromZoomState = loadStateEnum.success;
            }
            return server.storage.records.update(item);
          });
      });

      return Promise.all(loadPromises);
    });
};

export const prepareYoutubeTask = (server) => {
  const itemsInProcessing = new Set();
  let oauthClientInitialized = false;
  const youtubeServices = new Map();
  const playlistIdMap = new Map();

  const getPlayLists = (yt, pageToken = undefined) => yt.playlists
    .list({
      part: ['id', 'snippet'],
      maxResults: 50,
      channelId: 'UCWVUbtI0-qFejcMFacA9nrA',
      pageToken,
    })
    .then((res) => {
      res.data.items.forEach((item) => {
        playlistIdMap.set(item.snippet.title, item.id);
      });
      if (res.data.nextPageToken) {
        return getPlayLists(res.data.nextPageToken);
      }

      return true;
    });

  const createPlaylist = (yt, title) => yt.playlists
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
      playlistIdMap.set(res.data.snippet.title, res.data.id);
    });

  const addToPlaylist = (yt, { youtubePlaylist, videoId }) => {
    const playlistId = playlistIdMap.get(youtubePlaylist);

    return yt.playlistItems
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
  };

  const insertToPlaylist = (youtubeService, { youtubePlaylist, videoId }) => (playlistIdMap.has(youtubePlaylist)
    ? addToPlaylist(youtubeService, { youtubePlaylist, videoId })
    : createPlaylist(youtubeService, youtubePlaylist)
      .then(() => addToPlaylist(youtubeService, { youtubePlaylist, videoId })));

  return () => {
    if (!oauthClientInitialized) {
      return server.storage.tokens.get()
        .then((tokens) => {
          const isEmpty = Object.keys(tokens).length === 0;
          if (!isEmpty) {
            server.oauthClient.setCredentials(tokens);

            youtubeService = google.youtube({
              version: 'v3',
              auth: server.oauthClient,
            });

            oauthClientInitialized = true;

            return getPlayLists();
          }

          return true;
        });
    }

    return server.storage.records
      .read({
        loadFromZoomState: loadStateEnum.success,
        loadToYoutubeState: loadStateEnum.ready,
      })
      .then((items) => {
        const loadPromises = items.map((item) => {
          if (itemsInProcessing.has(item.id)) {
            return Promise.resolve();
          }
          itemsInProcessing.add(item.id);
          const { data } = item;

          if (!fs.existsSync(data.meta.filepath)) {
            item.loadToYoutubeState = loadStateEnum.failed;
            item.loadToYoutubeError = 'File not exists';
            return server.storage.records.update(item);
          }

          return youtubeService.videos
            .insert({
              part: ['id', 'snippet', 'contentDetails', 'status'],
              notifySubscribers: false,
              requestBody: {
                snippet: {
                  title: data.meta.youtubeName,
                  description: data.meta.youtubeDescription,
                },
                status: {
                  privacyStatus: 'unlisted',
                },
              },
              media: {
                body: fs.createReadStream(data.meta.filepath),
              },
            })
            .catch((err) => {
              console.error(err);
              item.loadToYoutubeError = err.message;
              item.loadToYoutubeState = loadStateEnum.failed;
            })
            .then((res) => {
              if (item.loadToYoutubeState !== loadStateEnum.failed) {
                item.loadToYoutubeState = loadStateEnum.success;
                data.meta.youtubeUrl = `https://youtu.be/${res.data.id}`;
              }
              return server.storage.records.update(item)
                .then(() => res.data.id);
            })
            .then((videoId) => {
              if (item.loadToYoutubeState !== loadStateEnum.failed) {
                return insertToPlaylist({
                  videoId,
                  youtubePlaylist: data.meta.youtubePlaylist,
                });
              }
              return true;
            });
        });

        return Promise.all(loadPromises);
      });
  };
};
