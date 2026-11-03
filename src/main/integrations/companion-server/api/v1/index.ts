import { transformPlayerState } from "./player-state";
import { type WebContents, BrowserWindow, ipcMain } from "electron";
import Conf from "conf";
import { type FastifyPluginAsync, type FastifyPluginOptions } from "fastify";
import { isRecord } from "~shared/unknown";
import { type MemoryStoreSchema, type StoreSchema } from "~shared/store/schema";
import { MemoryStore } from "../../../../memory-store";
import { playerStateStore, type PlayerState, RepeatMode } from "../../../../player-state-store";
import {
  clearFailedAuth,
  createAuthToken,
  getIsTemporaryAuthCodeValidAndRemove,
  getTemporaryAuthCode,
  isAuthLockedOut,
  isAuthValid,
  isAuthValidMiddleware,
  rateLimitKey,
  recordFailedAuth,
} from "../../api-shared/auth";
import { socketServer } from "../../api-shared/socket-server";
import fastifyRateLimit from "@fastify/rate-limit";
import crypto from "crypto";
import { senderFrameIsMainAt, senderIsView, type SenderEvent } from "../../../../ipc/sender-guards";
import { YTM_ORIGIN } from "../../../../ytm-navigation";
import { createAppWindow, loadWindowEntry } from "../../../../windows/window-factory";
import {
  APIV1CommandRequestBody,
  type APIV1CommandRequestBodyType,
  APIV1RequestCodeBody,
  type APIV1RequestCodeBodyType,
  APIV1RequestTokenBody,
  type APIV1RequestTokenBodyType,
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
  YouTubeMusicUnavailableError,
} from "../../api-shared/errors";
import path from "node:path";

declare const ALL_WINDOWS_VITE_DEV_SERVER_URL: string;

export type CompanionYtmView = { webContents: Pick<WebContents, "send"> };

type CompanionServerAPIv1Options = {
  getStore: () => Conf<StoreSchema>;
  getMemoryStore: () => MemoryStore<MemoryStoreSchema>;
  getYtmView: () => CompanionYtmView | null;
} & FastifyPluginOptions;

type Playlist = {
  id: string;
  title: string;
};

const PLAYLIST_ID_MAX_LENGTH = 256;
const PLAYLIST_TITLE_MAX_LENGTH = 1024;

const isPlaylistId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= PLAYLIST_ID_MAX_LENGTH;

const toObservedPlaylist = (value: unknown): Playlist | null => {
  if (!isRecord(value)) return null;
  const { id, title } = value;
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

const CompanionServerAPIv1: FastifyPluginAsync<CompanionServerAPIv1Options> = async (fastify, options) => {
  const authWindowEnabledListener = (key: string, value: unknown) => {
    if (key === "companionServerAuthWindowEnabled" && !value) {
      cancelPendingAuthorizations();
    }
  };
  options.getMemoryStore().onStateChanged(authWindowEnabledListener);
  fastify.addHook("preClose", (done) => {
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
              playlistId: playlistId,
            },
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
            case RepeatMode.Unknown:
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
          const queueLength = queue ? queue.items.length + queue.automixItems.length : 0;

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
    timeWindow: 1000 * 60,
  });

  fastify.post<{ Body: APIV1RequestCodeBodyType }>(
    "/auth/requestcode",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: 1000 * 60,
        },
      },
      schema: {
        body: APIV1RequestCodeBody,
      },
    },
    async (request, response) => {
      const isCompanionAuthWindowEnabled = Boolean(options.getMemoryStore().get("companionServerAuthWindowEnabled"));

      if (!isCompanionAuthWindowEnabled) {
        throw new AuthorizationDisabledError();
      }

      const code = await getTemporaryAuthCode(request.body.appId, request.body.appVersion, request.body.appName);
      if (code) {
        response.send({
          code,
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
          timeWindow: 1000 * 60,
        },
      },
      schema: {
        body: APIV1RequestTokenBody,
      },
    },
    async (request, response) => {
      const isCompanionAuthWindowEnabled = Boolean(options.getMemoryStore().get("companionServerAuthWindowEnabled"));

      if (authorizationWindows.length >= 5) {
        throw new AuthorizationTooManyError();
      }

      if (!isCompanionAuthWindowEnabled) {
        throw new AuthorizationDisabledError();
      }

      const authData = getIsTemporaryAuthCodeValidAndRemove(request.body.appId, request.body.code);
      if (!authData) {
        throw new AuthorizationInvalidError();
      }

      const requestId = crypto.randomUUID();
      const detailsChannel = `companionAuthorization:details:${requestId}`;

      const authorizationState = { isClosed: false };

      const authorizationWindow = createAppWindow({
        width: 640,
        height: 480,
        minimizable: false,
        maximizable: false,
        resizable: false,
        webPreferences: {
          preload: path.join(__dirname, `../renderer/windows/authorize-companion/preload.js`),
          additionalArguments: [requestId],
        },
      });
      loadWindowEntry(authorizationWindow, "authorize-companion", ALL_WINDOWS_VITE_DEV_SERVER_URL);
      authorizationWindow.show();
      authorizationWindow.flashFrame(true);

      authorizationWindows.push(authorizationWindow);

      try {
        ipcMain.handle(detailsChannel, (event) => {
          if (!senderIsView(authorizationWindow, event.sender)) return null;
          return { appName: authData.appName, code: request.body.code };
        });

        if (process.env.NODE_ENV === "development" && !process.env.YTMD_TEST) {
          authorizationWindow.webContents.openDevTools({
            mode: "detach",
          });
        }

        let promiseResolve: (value: boolean | PromiseLike<boolean>) => void;
        let promiseInterval: string | number | NodeJS.Timeout;

        const resultListener = (event: Electron.IpcMainEvent, isAuthorized: boolean) => {
          if (!senderIsView(authorizationWindow, event.sender)) return;

          clearInterval(promiseInterval);
          promiseResolve(isAuthorized && options.getMemoryStore().get("companionServerAuthWindowEnabled") === true);
        };

        const cancel = () => {
          clearInterval(promiseInterval);
          promiseResolve(false);
        };

        const closeListener = (event: Electron.IpcMainEvent | null) => {
          if (event && !senderIsView(authorizationWindow, event.sender)) return;

          clearInterval(promiseInterval);
          promiseResolve(false);
        };

        const startTime = Date.now();
        const isAuthorized = await new Promise<boolean>((resolve) => {
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
            authorizationState.isClosed = true;
            closeListener(null);
          });
          pendingAuthorizations.add(cancel);
        });
        pendingAuthorizations.delete(cancel);

        if (!authorizationState.isClosed) {
          authorizationWindow.removeAllListeners();
          authorizationWindow.close();
        }
        ipcMain.removeListener(`companionAuthorization:result:${requestId}`, resultListener);
        ipcMain.removeListener(`companionWindow:close:${requestId}`, closeListener);

        if (isAuthorized) {
          const token = createAuthToken(options.getStore(), authData.appId, authData.appVersion, authData.appName);

          clearFailedAuth(request.ip);
          response.send({
            token,
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
        rateLimit: {
          max: 1,
          timeWindow: 1000 * 30,
          keyGenerator: (request) => {
            return rateLimitKey(options.getStore(), request);
          },
        },
      },
      preHandler: (request, response, next) => {
        isAuthValidMiddleware(options.getStore(), request, response, next);
      },
    },
    async (_request, response) => {
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
        rateLimit: {
          max: 1,
          timeWindow: 1000 * 5,
          keyGenerator: (request) => {
            return rateLimitKey(options.getStore(), request);
          },
        },
      },
      preHandler: (request, response, next) => {
        isAuthValidMiddleware(options.getStore(), request, response, next);
      },
    },
    (_request, response) => {
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
          keyGenerator: (request) => {
            return rateLimitKey(options.getStore(), request);
          },
        },
      },
      schema: {
        body: APIV1CommandRequestBody,
      },
      preHandler: (request, response, next) => {
        isAuthValidMiddleware(options.getStore(), request, response, next);
      },
    },
    (request, response) => {
      sendCommand(request.body);
      response.code(204).send();
    }
  );

  void Promise.resolve(fastify.ready())
    .then(() => {
      socketServer(fastify)
        .of("/api/v1/realtime")
        .use((socket, next) => {
          const address = socket.handshake.address;
          if (isAuthLockedOut(address)) {
            next(new UnauthenticatedError());
            return;
          }

          const token: unknown = socket.handshake.auth.token;
          const [isValidSession, tokenId] = isAuthValid(options.getStore(), typeof token === "string" ? token : undefined);
          if (isValidSession) {
            const socketData: unknown = socket.data;
            if (!isRecord(socketData)) throw new TypeError("Companion socket metadata is unavailable");
            socketData.tokenId = tokenId;
            next();
          } else {
            recordFailedAuth(address);
            next(new UnauthenticatedError());
          }
        });

      const stateStoreListener = (state: PlayerState) => {
        socketServer(fastify).of("/api/v1/realtime").emit("state-update", transformPlayerState(state));
      };
      playerStateStore.addEventListener(stateStoreListener);

      const isYtmViewPage = (event: SenderEvent) => senderIsView(options.getYtmView(), event.sender) && senderFrameIsMainAt(event, [YTM_ORIGIN]);

      const createPlaylistObservedListener = (event: Electron.IpcMainEvent, value: unknown) => {
        if (!isYtmViewPage(event)) return;
        const playlist = toObservedPlaylist(value);
        if (!playlist) return;

        socketServer(fastify).of("/api/v1/realtime").emit("playlist-created", playlist);
      };
      ipcMain.on("ytmView:createPlaylistObserved", createPlaylistObservedListener);

      const deletePlaylistObservedListener = (event: Electron.IpcMainEvent, playlistId: unknown) => {
        if (!isYtmViewPage(event) || !isPlaylistId(playlistId)) return;

        socketServer(fastify).of("/api/v1/realtime").emit("playlist-deleted", playlistId);
      };
      ipcMain.on("ytmView:deletePlaylistObserved", deletePlaylistObservedListener);

      fastify.addHook("onClose", () => {
        void socketServer(fastify)
          .close()
          .catch((error: unknown) => console.warn("Companion socket server could not close", error));
        playerStateStore.removeEventListener(stateStoreListener);
        ipcMain.off("ytmView:createPlaylistObserved", createPlaylistObservedListener);
        ipcMain.off("ytmView:deletePlaylistObserved", deletePlaylistObservedListener);
      });
    })
    .catch((error: unknown) => console.warn("index: operation failed", error));
};

export { CompanionServerAPIv1 };
