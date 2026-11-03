import { describe, expect, it } from "vitest";
import { transformPlayerState } from "../src/main/integrations/companion-server/api/v1/player-state";
import { partialPlayerState } from "./helpers/partial-player-state";

describe("companion player metadata", () => {
  it.each([{ videoId: "partial" }, { videoId: "partial", title: null, author: null, channelId: null }])(
    "serializes normalized partial metadata %j",
    (payload) => {
      const state = partialPlayerState(payload);
      const output: unknown = JSON.parse(JSON.stringify(transformPlayerState(state)));
      expect(output).toMatchObject({ video: { id: "partial", title: "", author: "", channelId: "", thumbnails: [], metadataFilled: true } });
    }
  );
});
