import { BrowserView, BrowserWindow, ipcMain } from "electron";
import Conf from "conf";
import { FastifyPluginCallback, FastifyPluginOptions } from "fastify";
import { MemoryStoreSchema, StoreSchema } from "~shared/store/schema";
import MemoryStore from "../../../../memory-store";
import playerStateStore, { PlayerState, RepeatMode } from "../../../../player-state-store";
import {
  clearFailedAuth,
  createAuthToken,
  getIsTemporaryAuthCodeValidAndRemove,
  getTemporaryAuthCode,
  isAuthLockedOut,
  isAuthValid,
  isAuthValidMiddleware,
  rateLimitKey,
  recordFailedAuth
} from "../../api-shared/auth";
import fastifyRateLimit from "@fastify/rate-limit";
import crypto from "crypto";
import { senderFrameIsMainAt, senderIsView, type SenderEvent } from "../../../../ipc/sender-guards";
import { YTM_ORIGIN } from "../../../../ytm-navigation";
import { createAppWindow, loadWindowEntry } from "../../../../windows/window-factory";
import {
  APIV1CommandRequestBody,
  APIV1CommandRequestBodyType,
  APIV1RequestCodeBody,
  APIV1RequestCodeBodyType,
  APIV1RequestTokenBody,
  APIV1RequestTokenBodyType
} from "../../api-shared/schemas";
import {
  AuthorizationDeniedError,
  AuthorizationDisabledError,
  AuthorizationInvalidError,
  AuthorizationTimeOutError,
  AuthorizationTooManyError,
  InvalidPositionError,
  InvalidQueueIndexError,
  InvalidRepeatModeError,
  InvalidChangeVideoRequestError,
  InvalidVolumeError,
  UnauthenticatedError,
  YouTubeMusicTimeOutError,
  YouTubeMusicUnavailableError
} from "../../api-shared/errors";
import path from "node:path";

declare const ALL_WINDOWS_VITE_DEV_SERVER_URL: string;

const transformPlayerState = (state: PlayerState) => {
  return {
    player: {
      trackState: state.trackState,
      videoProgress: state.videoProgress,
      volume: state.volume,
      muted: state.muted,
      adPlaying: state.adPlaying,
      queue: state.queue
        ? {
            autoplay: state.queue.autoplay,
            items: state.queue.items,
            automixItems: state.queue.automixItems,
            isGenerating: state.queue.isGenerating,
            isInfinite: state.queue.isInfinite,
            repeatMode: state.queue.repeatMode,
            selectedItemIndex: state.queue.selectedItemIndex
          }
        : null
    },
    video: state.videoDetails
      ? {
          author: state.videoDetails.author,
          channelId: state.videoDetails.channelId,
          title: state.videoDetails.title,
          album: state.videoDetails.album,
          albumId: state.videoDetails.albumId,
          likeStatus: state.videoDetails.likeStatus,
          thumbnails: state.videoDetails.thumbnails,
          durationSeconds: state.videoDetails.durationSeconds,
          id: state.videoDetails.id,
          isLive: state.videoDetails.isLive,
          videoType: state.videoDetails.videoType,
          // API Users: In YTM the initial player response for a song may not contain filled out metadata is fetched via another requests. This indicates that is complete.
          //            For context you can refer to YTM playing a song but the player bar not displaying the information for the song yet. This is that behavior.
          metadataFilled: state.hasFullMetadata
        }
      : null,
    // API Users:
    // WARNING! WARNING! WARNING! WARNING!
    // playlistId may not be what you expect it to be.
    // - If the song playing comes from a randomly generated radio queue then this will be the id of that random queue (YTM does not persist these, pretend these IDs don't exist on the YTM backend)
    // - If you add an album/playlist to queue once those songs start playing then playlistId will be the id of that album/playlist
    // - Play Next for individual songs have a null playlistId when reached in a queue. Does not apply for Play Next to an entire album/playlist.
    // In summary, this property doesn't reliably tell you this video belongs to the specified playlistId. Do not treat it as such. Use it as a state if something may be playing from a known playlistId
    playlistId: state.playlistId
  };
};

interface CompanionServerAPIv1Options extends FastifyPluginOptions {
  getStore: () => Conf<StoreSchema>;
  getMemoryStore: () => MemoryStore<MemoryStoreSchema>;
  getYtmView: () => BrowserView;
}

type Playlist = {
  id: string;
  title: string;
};

const PLAYLIST_ID_MAX_LENGTH = 256;
const PLAYLIST_TITLE_MAX_LENGTH = 1024;

const isPlaylistId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= PLAYLIST_ID_MAX_LENGTH;

const toObservedPlaylist = (value: unknown): Playlist | null => {
  if (typeof value !== "object" || value === null) return null;
  const { id, title } = value as Record<string, unknown>;
  if (!isPlaylistId(id) || typeof title !== "string" || title.length > PLAYLIST_TITLE_MAX_LENGTH) return null;
  return { id, title };
};

const authorizationWindows: BrowserWindow[] = [];
const pendingAuthorizations = new Set<() => void>();

const cancelPendingAuthorizations = () => {
  for (const cancel of [...pendingAuthorizations]) {
    cancel();
  }
};

const CompanionServerAPIv1: FastifyPluginCallback<CompanionServerAPIv1Options> = async (fastify, options) => {
  const authWindowEnabledListener = (key: string, value: unknown) => {
    if (key === "companionServerAuthWindowEnabled" && !value) {
      cancelPendingAuthorizations();
    }
  };
  options.getMemoryStore().onStateChanged(authWindowEnabledListener);
  fastify.addHook("preClose", done => {
    options.getMemoryStore().removeOnStateChanged(authWindowEnabledListener);
    cancelPendingAuthorizations();
    done();
  });

  const sendCommand = (commandRequest: APIV1CommandRequestBodyType) => {
    const ytmView = options.getYtmView();
    if (ytmView) {
      switch (commandRequest.command) {
        case "playPause": {
          ytmView.webContents.send("remoteControl:execute", "playPause");
          break;
        }

        case "play": {
          ytmView.webContents.send("remoteControl:execute", "play");
          break;
        }

        case "pause": {
          ytmView.webContents.send("remoteControl:execute", "pause");
          break;
        }

        case "volumeUp": {
          ytmView.webContents.send("remoteControl:execute", "volumeUp");
          break;
        }

        case "volumeDown": {
          ytmView.webContents.send("remoteControl:execute", "volumeDown");
          break;
        }

        case "setVolume": {
          const volume = commandRequest.data;
          // Check if Volume is a number and between 0 and 100
          if (isNaN(volume) || volume < 0 || volume > 100) {
            throw new InvalidVolumeError(volume);
          }

          ytmView.webContents.send("remoteControl:execute", "setVolume", volume);
          break;
        }

        case "mute": {
          ytmView.webContents.send("remoteControl:execute", "mute");
          break;
        }

        case "unmute": {
          ytmView.webContents.send("remoteControl:execute", "unmute");
          break;
        }

        case "seekTo": {
          const position = commandRequest.data;
          const seekTarget = playerStateStore.getState().videoDetails;
          if (!seekTarget || isNaN(position) || position < 0 || position > seekTarget.durationSeconds) {
            throw new InvalidPositionError(position);
          }
          ytmView.webContents.send("remoteControl:execute", "seekTo", position);
          break;
        }

        case "changeVideo": {
          const videoId = commandRequest.data.videoId;
          const playlistId = commandRequest.data.playlistId;
          if (videoId == null && playlistId == null) {
            throw new InvalidChangeVideoRequestError();
          }
          ytmView.webContents.send("remoteControl:execute", "navigate", {
            watchEndpoint: {
              videoId: videoId,
              playlistId: playlistId
            }
          });
          break;
        }

        case "next": {
          ytmView.webContents.send("remoteControl:execute", "next");
          break;
        }

        case "previous": {
          ytmView.webContents.send("remoteControl:execute", "previous");
          break;
        }

        case "repeatMode": {
          const repeatMode = commandRequest.data;
          switch (repeatMode) {
            case RepeatMode.None: {
              ytmView.webContents.send("remoteControl:execute", "repeatMode", "NONE");
              break;
            }
            case RepeatMode.All: {
              ytmView.webContents.send("remoteControl:execute", "repeatMode", "ALL");
              break;
            }
            case RepeatMode.One: {
              ytmView.webContents.send("remoteControl:execute", "repeatMode", "ONE");
              break;
            }
            default: {
              throw new InvalidRepeatModeError(repeatMode);
            }
          }
          break;
        }

        case "shuffle": {
          ytmView.webContents.send("remoteControl:execute", "shuffle");
          break;
        }

        case "playQueueIndex": {
          const index = commandRequest.data;
          const queue = playerStateStore.getState().queue;
          const queueLength = queue ? (queue.items?.length ?? 0) + (queue.automixItems?.length ?? 0) : 0;

          if (!Number.isInteger(index) || index < 0 || index >= queueLength) {
            throw new InvalidQueueIndexError(index);
          }

          ytmView.webContents.send("remoteControl:execute", "playQueueIndex", index);
          break;
        }

        case "toggleLike": {
          ytmView.webContents.send("remoteControl:execute", "toggleLike");
          break;
        }

        case "toggleDislike": {
          ytmView.webContents.send("remoteControl:execute", "toggleDislike");
          break;
        }
      }
    }
  };

  await fastify.register(fastifyRateLimit, {
    global: true,
    max: 100,
    timeWindow: 1000 * 60
  });

  fastify.post<{ Body: APIV1RequestCodeBodyType }>(
    "/auth/requestcode",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: 1000 * 60
        }
      },
      schema: {
        body: APIV1RequestCodeBody
      }
    },
    async (request, response) => {
      const companionServerAuthWindowEnabled = options.getMemoryStore().get("companionServerAuthWindowEnabled") ?? false;

      // API Users: The user has companion server authorization disabled, show a feedback error accordingly
      if (!companionServerAuthWindowEnabled) {
        throw new AuthorizationDisabledError();
      }

      const code = await getTemporaryAuthCode(request.body.appId, request.body.appVersion, request.body.appName);
      if (code) {
        response.send({
          code
        });
      } else {
        throw new AuthorizationTimeOutError();
      }
    }
  );

  fastify.post<{ Body: APIV1RequestTokenBodyType }>(
    "/auth/request",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: 1000 * 60
        }
      },
      schema: {
        body: APIV1RequestTokenBody
      }
    },
    async (request, response) => {
      const companionServerAuthWindowEnabled = options.getMemoryStore().get("companionServerAuthWindowEnabled") ?? false;

      // There's too many authorization windows open and we have to reject this request for now (this is unlikely to occur but this prevents malicious use of spamming auth windows)
      // API Users: Show a friendly feedback that too many applications are trying to authorize at the same time
      if (authorizationWindows.length >= 5) {
        throw new AuthorizationTooManyError();
      }

      // API Users: The user has companion server authorization disabled, show a feedback error accordingly
      if (!companionServerAuthWindowEnabled) {
        throw new AuthorizationDisabledError();
      }

      // API Users: Make sure you /requestcode above
      const authData = getIsTemporaryAuthCodeValidAndRemove(request.body.appId, request.body.code);
      if (!authData) {
        throw new AuthorizationInvalidError();
      }

      const requestId = crypto.randomUUID();
      const detailsChannel = `companionAuthorization:details:${requestId}`;

      let authorizationWindowClosed = false;

      // Create the authorization browser window.
      const authorizationWindow = createAppWindow({
        width: 640,
        height: 480,
        minimizable: false,
        maximizable: false,
        resizable: false,
        webPreferences: {
          preload: path.join(__dirname, `../renderer/windows/authorize-companion/preload.js`),
          additionalArguments: [requestId]
        }
      });
      loadWindowEntry(authorizationWindow, "authorize-companion", ALL_WINDOWS_VITE_DEV_SERVER_URL);
      authorizationWindow.show();
      authorizationWindow.flashFrame(true);

      authorizationWindows.push(authorizationWindow);

      try {
        ipcMain.handle(detailsChannel, event => {
          if (!senderIsView(authorizationWindow, event.sender)) return null;
          return { appName: authData.appName, code: request.body.code };
        });

        // Open the DevTools.
        if (process.env.NODE_ENV === "development" && !process.env.YTMD_TEST) {
          authorizationWindow.webContents.openDevTools({
            mode: "detach"
          });
        }

        let promiseResolve: (value: boolean | PromiseLike<boolean>) => void;
        let promiseInterval: string | number | NodeJS.Timeout;

        const resultListener = (event: Electron.IpcMainEvent, authorized: boolean) => {
          if (!senderIsView(authorizationWindow, event.sender)) return;

          clearInterval(promiseInterval);
          promiseResolve(authorized === true && options.getMemoryStore().get("companionServerAuthWindowEnabled") === true);
        };

        const cancel = () => {
          clearInterval(promiseInterval);
          promiseResolve(false);
        };

        const closeListener = (event: Electron.IpcMainEvent) => {
          if (event && !senderIsView(authorizationWindow, event.sender)) return;

          clearInterval(promiseInterval);
          promiseResolve(false);
        };

        const startTime = Date.now();
        const authorized = await new Promise<boolean>(resolve => {
          promiseResolve = resolve;
          promiseInterval = setInterval(() => {
            if (request.socket.destroyed) {
              clearInterval(promiseInterval);
              resolve(false);
            }

            if (Date.now() - startTime > 30 * 1000) {
              clearInterval(promiseInterval);
              resolve(false);
            }
          }, 250);

          ipcMain.on(`companionAuthorization:result:${requestId}`, resultListener);
          ipcMain.on(`companionWindow:close:${requestId}`, closeListener);
          authorizationWindow.once("closed", () => {
            authorizationWindowClosed = true;
            closeListener(null);
          });
          pendingAuthorizations.add(cancel);
        });
        pendingAuthorizations.delete(cancel);

        if (!authorizationWindowClosed) {
          authorizationWindow.removeAllListeners();
          authorizationWindow.close();
        }
        ipcMain.removeListener(`companionAuthorization:result:${requestId}`, resultListener);
        ipcMain.removeListener(`companionWindow:close:${requestId}`, closeListener);

        if (authorized) {
          const token = createAuthToken(options.getStore(), authData.appId, authData.appVersion, authData.appName);

          clearFailedAuth(request.ip);
          response.send({
            token
          });
          options.getMemoryStore().set("companionServerAuthWindowEnabled", false);
        } else {
          throw new AuthorizationDeniedError();
        }
      } finally {
        ipcMain.removeHandler(detailsChannel);
        const index = authorizationWindows.indexOf(authorizationWindow);
        if (index > -1) {
          authorizationWindows.splice(index, 1);
        }
      }
    }
  );

  fastify.get(
    "/playlists",
    {
      config: {
        // This endpoint sends a real API request to YTM which allows to fetch playlists.
        // API users: Please cache playlists, they are unlikely to change often. A websocket event will be emitted if a playlist is created or deleted
        rateLimit: {
          max: 1,
          timeWindow: 1000 * 30,
          keyGenerator: request => {
            return rateLimitKey(options.getStore(), request);
          }
        }
      },
      preHandler: (request, response, next) => {
        return isAuthValidMiddleware(options.getStore(), request, response, next);
      }
    },
    async (request, response) => {
      const ytmView = options.getYtmView();
      if (ytmView) {
        const requestId = crypto.randomUUID();
        const responseChannel = `ytmView:getPlaylists:response:${requestId}`;

        const playlists = await new Promise<Playlist[]>((resolve, reject) => {
          const timeout = setTimeout(() => {
            ipcMain.removeListener(responseChannel, playlistsResponseListener);
            reject(new YouTubeMusicTimeOutError());
          }, 1000 * 30);

          const playlistsResponseListener = (event: Electron.IpcMainEvent, playlists: Playlist[]) => {
            if (event.sender !== ytmView.webContents) return;
            clearTimeout(timeout);
            ipcMain.removeListener(responseChannel, playlistsResponseListener);
            resolve(playlists);
          };
          ipcMain.on(responseChannel, playlistsResponseListener);

          ytmView.webContents.send(`ytmView:getPlaylists`, requestId);
        });

        response.send(playlists);
      } else {
        throw new YouTubeMusicUnavailableError();
      }
    }
  );

  fastify.get(
    "/state",
    {
      config: {
        // API users: Please utilize the realtime websocket to get the state. Request this endpoint as necessary, such as initial state fetching.
        rateLimit: {
          max: 1,
          timeWindow: 1000 * 5,
          keyGenerator: request => {
            return rateLimitKey(options.getStore(), request);
          }
        }
      },
      preHandler: (request, response, next) => {
        return isAuthValidMiddleware(options.getStore(), request, response, next);
      }
    },
    (request, response) => {
      response.send(transformPlayerState(playerStateStore.getState()));
    }
  );

  fastify.post<{ Body: APIV1CommandRequestBodyType }>(
    "/command",
    {
      config: {
        rateLimit: {
          max: 2,
          timeWindow: 1000 * 1,
          keyGenerator: request => {
            return rateLimitKey(options.getStore(), request);
          }
        }
      },
      schema: {
        body: APIV1CommandRequestBody
      },
      preHandler: (request, response, next) => {
        return isAuthValidMiddleware(options.getStore(), request, response, next);
      }
    },
    (request, response) => {
      sendCommand(request.body);
      response.code(204).send();
    }
  );

  fastify.ready().then(() => {
    fastify.io.of("/api/v1/realtime").use((socket, next) => {
      const address = socket.handshake.address;
      if (isAuthLockedOut(address)) {
        next(new UnauthenticatedError());
        return;
      }

      const token = socket.handshake.auth.token;
      const [validSession, tokenId] = isAuthValid(options.getStore(), token);
      if (validSession) {
        socket.data.tokenId = tokenId;
        next();
      } else {
        recordFailedAuth(address);
        next(new UnauthenticatedError());
      }
    });
    // Will look into enabling sending commands/requests over the websocket at a later point in time
    /*fastify.io.of("/api/v1/realtime").on("connection", socket => {
      socket.on("command", (command: RemoteCommand) => {
        sendCommand(command);
      });
    });*/

    const stateStoreListener = (state: PlayerState) => {
      fastify.io.of("/api/v1/realtime").emit("state-update", transformPlayerState(state));
    };
    playerStateStore.addEventListener(stateStoreListener);

    const isYtmViewPage = (event: SenderEvent) => senderIsView(options.getYtmView(), event.sender) && senderFrameIsMainAt(event, [YTM_ORIGIN]);

    const createPlaylistObservedListener = (event: Electron.IpcMainEvent, value: unknown) => {
      if (!isYtmViewPage(event)) return;
      const playlist = toObservedPlaylist(value);
      if (!playlist) return;

      fastify.io.of("/api/v1/realtime").emit("playlist-created", playlist);
    };
    ipcMain.on("ytmView:createPlaylistObserved", createPlaylistObservedListener);

    const deletePlaylistObservedListener = (event: Electron.IpcMainEvent, playlistId: unknown) => {
      if (!isYtmViewPage(event) || !isPlaylistId(playlistId)) return;

      fastify.io.of("/api/v1/realtime").emit("playlist-deleted", playlistId);
    };
    ipcMain.on("ytmView:deletePlaylistObserved", deletePlaylistObservedListener);

    fastify.addHook("onClose", () => {
      // This should normally close on its own but we'll make sure it's closed out
      fastify.io.close();
      playerStateStore.removeEventListener(stateStoreListener);
      ipcMain.off("ytmView:createPlaylistObserved", createPlaylistObservedListener);
      ipcMain.off("ytmView:deletePlaylistObserved", deletePlaylistObservedListener);
    });
  });
};

export default CompanionServerAPIv1;
