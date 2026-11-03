export type LastfmRequestBody = {
  method: string;
  timestamp?: number | null;

  artist?: string;
  track?: string;
  album?: string;
  duration?: number;

  format: "json" | "xml";
  api_key: string;
  sk?: string | null;
  api_sig?: string | null;
  token?: string;
};

export type LastfmErrorResponse = {
  code: number;
};

export type LastfmSessionResponse = {
  error: number;
  session: {
    name: string;
    key: string;
    subscriber: number;
  };
};

export type LastfmTokenResponse = {
  error: number;
  token: string;
};

export type LastfmApiResult =
  { ok: true; json: Record<string, unknown> } | { ok: false; kind: "auth" | "temporary" | "fatal"; code: number | null; message: string };
