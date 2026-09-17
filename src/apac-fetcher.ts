// Created by Rice.Lin
// Pins the outbound fetch to the source site at a Durable Object forced into
// the apac-se region (confirmed via locationHint to land in SIN, one of the
// two colos - alongside NRT - that the source doesn't challenge), instead of
// wherever the triggering request happened to land. Necessary but not
// sufficient on its own: confirmed via a live test that even a SIN-pinned
// fetch still gets Cloudflare's "Just a moment..." bot challenge when the
// invocation chain originates from a well-known automation IP (GitHub
// Actions) - so this is combined with using Cloudflare's own native Cron
// Trigger as the invocation source, which doesn't carry that reputation.
export class ApacFetcher {
  constructor(_state: unknown, _env: unknown) {}

  async fetch(request: Request): Promise<Response> {
    return fetch(request);
  }
}

export function apacFetch(namespace: DurableObjectNamespace): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const id = namespace.idFromName("singleton-se");
    const stub = namespace.get(id, { locationHint: "apac-se" });
    return stub.fetch(new Request(input as string, init));
  }) as typeof fetch;
}
