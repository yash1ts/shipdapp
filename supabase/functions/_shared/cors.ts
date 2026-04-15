/**
 * CORS for browser → Edge. Echo `Access-Control-Request-Headers` when present so
 * extra headers (browser extensions: baggage, sentry-trace, etc.) don't fail preflight.
 */
export function corsHeadersFor(req: Request): Record<string, string> {
  const fromBrowser = req.headers.get("Access-Control-Request-Headers");
  const allowHeaders =
    fromBrowser?.trim() ||
    "authorization, x-client-info, apikey, content-type, accept, accept-profile, prefer";

  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": allowHeaders,
    "Access-Control-Max-Age": "86400",
  };
}
