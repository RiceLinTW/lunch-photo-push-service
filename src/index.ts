export interface Env {
  DB: D1Database;
  VAPID_PRIVATE_KEY: string;
}

export default {
  async fetch(): Promise<Response> {
    return Response.json({ service: "lunch-photo-push-service", status: "ok" });
  },
} satisfies ExportedHandler<Env>;
