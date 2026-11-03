import type { FastifyInstance } from "fastify";
import { Server } from "socket.io";

function isSocketServer(value: unknown): value is Server {
  return value instanceof Server;
}

export function socketServer(server: FastifyInstance): Server {
  const io: unknown = Reflect.get(server, "io");
  if (!isSocketServer(io)) throw new Error("Companion socket server is unavailable");
  return io;
}
