export const DiscordActivityType = {
  Game: 0,
  [0]: "Game",
  Streaming: 1,
  [1]: "Streaming",
  Listening: 2,
  [2]: "Listening",
  Watching: 3,
  [3]: "Watching",
  Custom: 4,
  [4]: "Custom",
  Competing: 5,
  [5]: "Competing",
} as const;
export type DiscordActivityType = (typeof DiscordActivityType)[Exclude<keyof typeof DiscordActivityType, number>];

export const DiscordActivityStatusDisplayType = {
  Name: 0,
  [0]: "Name",
  State: 1,
  [1]: "State",
  Details: 2,
  [2]: "Details",
} as const;
export type DiscordActivityStatusDisplayType = (typeof DiscordActivityStatusDisplayType)[Exclude<keyof typeof DiscordActivityStatusDisplayType, number>];

export type DiscordActivity = {
  type?: DiscordActivityType;
  status_display_type: DiscordActivityStatusDisplayType;
  state?: string;
  state_url?: string;
  details?: string;
  details_url?: string;
  timestamps?: {
    start?: number;
    end?: number;
  };
  assets?: {
    large_image?: string;
    large_text?: string;
    large_url?: string;
    small_image?: string;
    small_text?: string;
    small_url?: string;
  };
  instance?: boolean;
  buttons?: {
    label: string;
    url: string;
  }[];
};
