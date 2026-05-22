// Netlify Edge Function: inject Open Graph + Twitter Card metadata into the
// SPA's index.html when a post-detail URL (/p/:uuid) is requested.
//
// Why this exists:
// - Link-preview scrapers (WhatsApp, iMessage, Slack, Twitterbot,
//   facebookexternalhit, Discord, LinkedIn, etc.) fetch the URL once with a
//   curl-like client. They do NOT execute JavaScript. The React Native Web
//   SPA's static index.html has no per-post metadata, so scrapers fall back
//   to the bare URL with no preview.
// - This edge runs in front of the SPA fallback, fetches per-post metadata
//   from the Django API (already proxied at /api/* by netlify.toml), and
//   splices <meta> tags into <head> before serving the modified HTML.
// - Everyone (humans + scrapers) gets the enriched HTML. No User-Agent
//   sniffing — that's brittle. Humans never see the meta tags so it's
//   harmless; scrapers parse them and render the preview card.
//
// Privacy:
// - The /api/posts/:uuid/share-metadata/ endpoint enforces the same
//   public-visibility gate as PostItem.get() for unauthenticated reads
//   (world circle OR public community). Non-public posts return
//   {"is_public": false} and we fall through to a generic branded card.
//
// Performance:
// - Sets Cache-Control: public, s-maxage=300 so Netlify's CDN absorbs
//   scraper bursts (Slack/FB tend to hammer the same URL 5-10x).
// - On any unexpected error we serve the unmodified index.html so the
//   human experience never breaks.

// Netlify provides Config + Context at runtime via Deno. The Deno-style URL
// import `https://edge.netlify.com/` would let TS resolve the real types, but
// it isn't reachable through the app's Node-based tsc. Declaring minimal
// local shapes keeps the baseline green without dropping coverage on the
// rest of this file.
interface Config {
  path?: string | string[];
}
interface Context {
  next: () => Promise<Response>;
}

interface ShareMetadata {
  is_public: boolean;
  title?: string;
  description?: string;
  image_url?: string | null;
  image_width?: number | null;
  image_height?: number | null;
  author_name?: string;
  author_username?: string;
  community_name?: string | null;
  type?: string;
}

const DEFAULT_TITLE = 'Openspace Social';
const DEFAULT_DESCRIPTION =
  'A social space for genuine conversations — communities, circles, and conversations worth having.';
const DEFAULT_OG_IMAGE = '/og-default.png';

function htmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildMetaTags(meta: ShareMetadata, canonicalUrl: string, origin: string): string {
  const title = htmlEscape(meta.title || DEFAULT_TITLE);
  const description = htmlEscape(meta.description || DEFAULT_DESCRIPTION);

  // Image MUST be an absolute URL for most scrapers (iMessage in particular
  // silently drops relative URLs). Promote to absolute via the request
  // origin if we got a path-relative fallback.
  let imageUrl = meta.image_url || `${origin}${DEFAULT_OG_IMAGE}`;
  if (imageUrl.startsWith('/')) {
    imageUrl = `${origin}${imageUrl}`;
  }
  imageUrl = htmlEscape(imageUrl);

  const ogType = htmlEscape(meta.type || 'article');
  const siteName = 'Openspace Social';

  // Twitter Cards use `summary_large_image` when we have a real image, else
  // a plain `summary` card (smaller, square-icon variant) — better UX than
  // a stretched 1024x1024 in the large layout.
  const twitterCard = meta.image_url ? 'summary_large_image' : 'summary';

  const lines: string[] = [
    `<meta property="og:type" content="${ogType}" />`,
    `<meta property="og:site_name" content="${htmlEscape(siteName)}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${htmlEscape(canonicalUrl)}" />`,
    `<meta property="og:image" content="${imageUrl}" />`,
  ];

  if (meta.image_width && meta.image_height) {
    lines.push(`<meta property="og:image:width" content="${meta.image_width}" />`);
    lines.push(`<meta property="og:image:height" content="${meta.image_height}" />`);
  }

  lines.push(
    `<meta name="twitter:card" content="${twitterCard}" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${imageUrl}" />`,
  );

  // Also override <title> so browser tabs / share dialogs that surface the
  // <title> instead of og:title (e.g. some Android browsers) show the
  // post-specific title rather than the generic SPA fallback.
  lines.push(`<title>${title}</title>`);

  return lines.join('\n    ');
}

async function fetchShareMetadata(origin: string, uuid: string): Promise<ShareMetadata | null> {
  try {
    // Hit the same origin so the Netlify /api/* proxy forwards to the
    // configured Django API (staging-api.openspace.social on staging,
    // openspace-api on prod).
    const url = `${origin}/api/posts/${encodeURIComponent(uuid)}/share-metadata/`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      // Short timeout — if the API is slow we'd rather serve the SPA
      // shell than block the scraper for 10+ seconds.
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return (await res.json()) as ShareMetadata;
  } catch {
    return null;
  }
}

function injectIntoHead(html: string, metaBlock: string): string {
  // Replace any existing <title>...</title> first so we don't end up with
  // two competing titles (ours + the SPA shell default).
  let result = html.replace(/<title>[^<]*<\/title>/i, '');

  // Splice the meta block immediately after the opening <head> tag. If for
  // some reason the SPA shell doesn't have <head> (it should, every Expo
  // web export does), append before </html> as a fallback — better than
  // dropping the metadata entirely.
  if (/<head[^>]*>/i.test(result)) {
    result = result.replace(/<head([^>]*)>/i, `<head$1>\n    ${metaBlock}`);
  } else {
    result = result.replace(/<\/html>/i, `${metaBlock}\n</html>`);
  }
  return result;
}

export default async (request: Request, context: Context): Promise<Response> => {
  const url = new URL(request.url);
  const uuidMatch = url.pathname.match(/^\/p\/([^\/?#]+)/);
  if (!uuidMatch) {
    return context.next();
  }
  const uuid = uuidMatch[1];

  // Fetch the SPA shell + per-post metadata in parallel. context.next()
  // pulls through the rest of the redirect chain (which lands on
  // /index.html) so we get the real built HTML.
  const [shellResponse, meta] = await Promise.all([
    context.next(),
    fetchShareMetadata(url.origin, uuid),
  ]);

  // If anything went sideways with the shell, return it unchanged.
  const contentType = shellResponse.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    return shellResponse;
  }

  let html: string;
  try {
    html = await shellResponse.text();
  } catch {
    return shellResponse;
  }

  // Build the meta block. If the API didn't return metadata or the post is
  // non-public, use the generic-card fallback (still better than the bare
  // SPA shell with no preview at all).
  const safeMeta: ShareMetadata = meta && meta.is_public ? meta : { is_public: false };
  const canonicalUrl = `${url.origin}/p/${uuid}`;
  const metaBlock = buildMetaTags(safeMeta, canonicalUrl, url.origin);
  const enriched = injectIntoHead(html, metaBlock);

  return new Response(enriched, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // CDN-cache for 5min so the scraper burst that follows a share
      // doesn't hammer the API. Browsers don't cache (max-age=0) so
      // post edits show up on next refresh.
      'cache-control': 'public, max-age=0, s-maxage=300',
      // Surface this for debugging without leaking sensitive state.
      'x-og-injected': safeMeta.is_public ? 'post' : 'fallback',
    },
  });
};

export const config: Config = {
  path: '/p/*',
};
