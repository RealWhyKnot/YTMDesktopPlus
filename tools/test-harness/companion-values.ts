import { type Static, Type } from "@sinclair/typebox";
import { validate } from "./validation.ts";
import { isRecord } from "./values.ts";

const nullable = <T extends ReturnType<typeof Type.Object>>(schema: T) => Type.Optional(Type.Union([schema, Type.Null()]));
const schema = Type.Object({
  code: Type.Optional(Type.String()),
  token: Type.Optional(Type.String()),
  apiVersions: Type.Optional(Type.Array(Type.String())),
  player: nullable(
    Type.Object({
      trackState: Type.Optional(Type.Number()),
      adPlaying: Type.Optional(Type.Boolean()),
      videoProgress: Type.Optional(Type.Number()),
      videoId: Type.Optional(Type.String()),
    })
  ),
  video: nullable(Type.Object({ id: Type.Optional(Type.String()) })),
});
export type CompanionBody = Static<typeof schema>;
export function responseBody(value: unknown): CompanionBody | null {
  return isRecord(value) ? validate(schema, value) : null;
}
