export type AppBindings = CloudflareBindings & {
  DB: D1Database;
  DISCORD_APPLICATION_ID: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_TOKEN: string;
  CARPOOL_CHANNEL_ID: string;
};
