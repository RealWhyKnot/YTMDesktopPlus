import log from "electron-log";
import { parseProtocolUrl } from "../shared/protocol-url";
import { cueTrack } from "./playback";

export function findProtocolUrl(argv: string[]) {
  return argv.find(argument => argument.startsWith("ytmdplus://")) ?? "";
}

export interface DeepLinkRouter {
  // Deep link commands other than play are pluggable; a feature registers its
  // command name and owns everything after it in the url.
  registerDeepLink(command: string, handler: (segments: string[], params: URLSearchParams) => void): () => void;
  handleProtocol(url: string): void;
  queueProtocolUrl(url: string): void;
  flushPending(): void;
}

export function createDeepLinkRouter(deps: { hasYtmView(): boolean }): DeepLinkRouter {
  // A link that starts the app arrives on argv, before there is a view to
  // drive. It is replayed once YouTube Music reports itself loaded.
  let pendingProtocolUrl: string | null = null;

  const deepLinkHandlers = new Map<string, (segments: string[], params: URLSearchParams) => void>();

  const registerDeepLink = (command: string, handler: (segments: string[], params: URLSearchParams) => void): (() => void) => {
    const name = command.toLowerCase();
    if (name === "play" || deepLinkHandlers.has(name)) {
      throw new Error(`Deep link command already taken: ${name}`);
    }
    deepLinkHandlers.set(name, handler);
    return () => {
      deepLinkHandlers.delete(name);
    };
  };

  const handleProtocol = (url: string): void => {
    if (!url) return;
    log.info("Handling protocol url", url);

    const request = parseProtocolUrl(url);
    if (!request) {
      log.info("Ignoring unrecognized protocol url");
      return;
    }

    if (!deps.hasYtmView()) {
      pendingProtocolUrl = url;
      return;
    }

    if (request.command === "other") {
      const handler = deepLinkHandlers.get(request.name);
      if (handler) handler(request.segments, request.params);
      else log.info(`Ignoring protocol url with unknown command ${request.name}`);
      return;
    }

    void cueTrack({ videoId: request.videoId, playlistId: request.playlistId, anchor: request.anchor });
  };

  return {
    registerDeepLink,
    handleProtocol,
    queueProtocolUrl: url => {
      pendingProtocolUrl = url;
    },
    flushPending: () => {
      if (pendingProtocolUrl) {
        const url = pendingProtocolUrl;
        pendingProtocolUrl = null;
        handleProtocol(url);
      }
    }
  };
}
