import type { Integration } from "../integration";
import Fastify, { type FastifyInstance } from "fastify";
import FastifyIO from "fastify-socket.io/dist/index";
import { CompanionServerAPIv1, type CompanionYtmView } from "./api/v1";
import { type MemoryStoreSchema, type StoreSchema } from "~shared/store/schema";
import Conf from "conf";
import { type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { type RemoteSocket, type DefaultEventsMap } from "socket.io";
import { WebSocketServer } from "ws";
import cors from "@fastify/cors";
import { MemoryStore } from "../../memory-store";
import log from "electron-log";
import { isDefinedAPIError } from "./api-shared/errors";
import { getAuthTokens } from "./api-shared/auth";
import { socketServer } from "./api-shared/socket-server";
import { isAllowedHost, isAllowedOrigin } from "./host-check";

export class CompanionServer implements Integration {
  private fastifyServerValue: FastifyInstance | undefined;
  private get fastifyServer(): FastifyInstance {
    const value = this.fastifyServerValue;
    if (value === undefined) throw new Error("Integration fastifyServer has not been provided");
    return value;
  }
  private set fastifyServer(value: FastifyInstance) {
    this.fastifyServerValue = value;
  }
  private storeValue: Conf<StoreSchema> | undefined;
  private get store(): Conf<StoreSchema> {
    const value = this.storeValue;
    if (value === undefined) throw new Error("Integration store has not been provided");
    return value;
  }
  private set store(value: Conf<StoreSchema>) {
    this.storeValue = value;
  }
  private memoryStoreValue: MemoryStore<MemoryStoreSchema> | undefined;
  private get memoryStore(): MemoryStore<MemoryStoreSchema> {
    const value = this.memoryStoreValue;
    if (value === undefined) throw new Error("Integration memoryStore has not been provided");
    return value;
  }
  private set memoryStore(value: MemoryStore<MemoryStoreSchema>) {
    this.memoryStoreValue = value;
  }
  private ytmView: CompanionYtmView | null = null;
  private storeListener: (() => void) | null = null;

  private listenPort: number;
  constructor(listenPort = 9863) {
    this.listenPort = listenPort;
  }

  private lanEnabled() {
    return this.store.get("integrations.companionServerLANEnabled", false);
  }

  private createServer(isAllowLan: boolean) {
    const isCorsWildcard = this.store.get("integrations.companionServerCORSWildcardEnabled", false);
    this.fastifyServer = Fastify().withTypeProvider<TypeBoxTypeProvider>();
    this.fastifyServer.addHook("onRequest", async (request, reply) => {
      if (!isAllowedHost(request.headers.host, isAllowLan)) {
        return reply.code(403).send({
          error: "INVALID_HOST",
        });
      }
    });
    this.fastifyServer.register(cors, {
      origin: isCorsWildcard ? "*" : false,
    });
    this.fastifyServer.register(FastifyIO, {
      transports: ["websocket"],
      allowUpgrades: false,

      wsEngine: WebSocketServer,
      allowRequest: (request, callback) => {
        callback(null, isAllowedHost(request.headers.host, isAllowLan) && isAllowedOrigin(request.headers.origin, request.headers.host, isCorsWildcard));
      },

      cors: {
        origin: isCorsWildcard ? "*" : false,
      },
    });
    this.fastifyServer.register(CompanionServerAPIv1, {
      prefix: "/api/v1",
      getYtmView: () => {
        return this.ytmView;
      },
      getStore: () => {
        return this.store;
      },
      getMemoryStore: () => {
        return this.memoryStore;
      },
    });
    this.fastifyServer.setErrorHandler((error, _request, reply) => {
      if (!isDefinedAPIError(error)) {
        const statusCode = error instanceof Error && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : undefined;
        if (!statusCode || statusCode >= 500) {
          log.error(error);
          reply.send(new Error("An internal server error occurred"));
          return;
        }
      }

      reply.send(error);
    });
    this.fastifyServer.get("/metadata", (_request, reply) => {
      reply.send({
        apiVersions: ["v1"],
      });
    });

    void Promise.resolve(this.fastifyServer.ready())
      .then(() => {
        socketServer(this.fastifyServer).on("connection", (socket) => socket.disconnect());
      })
      .catch((error: unknown) => log.warn("createServer failed", error));
  }

  public provide(store: Conf<StoreSchema>, memoryStore: MemoryStore<MemoryStoreSchema>, ytmView: CompanionYtmView | null): void {
    this.store = store;
    this.memoryStore = memoryStore;
    this.ytmView = ytmView;
  }

  public async enable() {
    if (!this.memoryStore.get("safeStorageAvailable")) {
      log.info("Refusing to enable Companion Server Integration with reason: safeStorage unavailable");
      return;
    }

    if (!this.fastifyServerValue?.server.listening) {
      const isAllowLan = this.lanEnabled();
      this.createServer(isAllowLan);
      await this.fastifyServer.listen({
        host: isAllowLan ? "0.0.0.0" : "127.0.0.1",
        port: this.listenPort,
      });
      const revokeSockets = async () => {
        const validTokenIds = getAuthTokens(this.store).map((authToken) => authToken.id);
        if (this.fastifyServer.server.listening) {
          const namespaces = socketServer(this.fastifyServer)._nsps.keys();
          let sockets: RemoteSocket<DefaultEventsMap, { tokenId: string }>[] = [];

          for (const namespace of namespaces) {
            const namespacedSockets = await socketServer(this.fastifyServer).of(namespace).fetchSockets();
            sockets = sockets.concat(namespacedSockets);
          }

          for (const socket of sockets) {
            if (!validTokenIds.includes(socket.data.tokenId)) {
              socket.disconnect(true);
            }
          }
        }
      };
      this.storeListener = this.store.onDidChange("integrations.companionServerAuthTokens", () => {
        void revokeSockets().catch((error: unknown) => log.error("Companion token revocation failed", error));
      });
    }
  }

  public async disable() {
    if (this.fastifyServerValue) {
      await this.fastifyServer.close();
      if (this.storeListener) {
        this.storeListener();
      }
    }
  }
}
