// AC Sync — GitHub OAuth Code Exchange Worker
// POST /exchange { code } → { access_token }

const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const ALLOWED_ORIGINS = /^chrome-extension:\/\/[a-z]{32}$/;

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(data, status, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

async function handleExchange(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const { code } = body;
  if (!code || typeof code !== "string") {
    return jsonResponse({ error: "missing_code" }, 400);
  }

  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    console.error("[AC Sync Worker] Missing env vars");
    return jsonResponse({ error: "server_misconfigured" }, 500);
  }

  const ghRes = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  if (!ghRes.ok) {
    console.error("[AC Sync Worker] GitHub returned", ghRes.status);
    return jsonResponse({ error: "github_error" }, 502);
  }

  const ghData = await ghRes.json();

  if (ghData.error) {
    return jsonResponse({ error: ghData.error }, 400);
  }

  if (!ghData.access_token) {
    return jsonResponse({ error: "no_token" }, 502);
  }

  return jsonResponse({ access_token: ghData.access_token }, 200);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const isAllowed = ALLOWED_ORIGINS.test(origin);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: isAllowed ? corsHeaders(origin) : {},
      });
    }

    // Only POST /exchange is allowed
    if (request.method !== "POST" || new URL(request.url).pathname !== "/exchange") {
      return jsonResponse({ error: "not_found" }, 404);
    }

    // Reject disallowed origins
    if (!isAllowed) {
      return jsonResponse({ error: "forbidden" }, 403);
    }

    try {
      return await handleExchange(request, env);
    } catch (err) {
      console.error("[AC Sync Worker] Unhandled error:", err);
      return jsonResponse({ error: "internal_error" }, 500);
    }
  },
};
