import { fetchExternalVideoPreview, getExternalVideoProviderLabel, parseExternalVideoUrl } from './externalVideoEmbeds';

export type ShortPostLinkPreview = {
  url: string;
  title: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
  isVideoEmbed?: boolean;
  isVideoLinkPreview?: boolean;
};

const URL_PATTERN = /(https?:\/\/[^\s]+)/gi;

function cleanupUrl(raw: string) {
  return raw.replace(/[),.;!?]+$/g, '').trim();
}

export function extractFirstUrlFromText(text?: string): string | null {
  if (!text) return null;
  const match = URL_PATTERN.exec(text);
  URL_PATTERN.lastIndex = 0;
  if (!match?.[0]) return null;
  const cleaned = cleanupUrl(match[0]);
  return cleaned || null;
}

export function getUrlHostLabel(url?: string) {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return url;
  }
}

function humanizeUrlTitle(url: string) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const candidate = parts[parts.length - 1] || parts[parts.length - 2] || '';
    const normalized = candidate
      .replace(/\.[a-z0-9]{2,6}$/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) return getUrlHostLabel(url) || url;
    return normalized
      .split(' ')
      .filter(Boolean)
      .slice(0, 16)
      .map((word) => (/^\d+$/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
      .join(' ');
  } catch {
    return getUrlHostLabel(url) || url;
  }
}

async function fetchJson(url: string, timeoutMs = 6500): Promise<any> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url, controller ? { signal: controller.signal } : undefined);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function pickBestText(...values: Array<string | undefined>) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function getNonEmbeddableSocialVideoPreview(url: string): ShortPostLinkPreview | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const parts = parsed.pathname.split('/').filter(Boolean);
    if ((host === 'facebook.com' || host.endsWith('.facebook.com')) && parts[0] === 'share' && (parts[1] === 'v' || parts[1] === 'r') && parts[2]) {
      return {
        url,
        title: parts[1] === 'r' ? 'Facebook reel' : 'Facebook video',
        description: 'Open on Facebook to watch.',
        siteName: 'Facebook',
        isVideoEmbed: false,
        isVideoLinkPreview: true,
      };
    }
  } catch {
    // Not a URL we recognize.
  }
  return null;
}

export async function fetchShortPostLinkPreview(url: string): Promise<ShortPostLinkPreview> {
  const video = parseExternalVideoUrl(url);
  if (video) {
    const preview = await fetchExternalVideoPreview(video.sourceUrl);
    return {
      url: video.sourceUrl,
      title: preview.title || `${getExternalVideoProviderLabel(video.provider)} video`,
      imageUrl: preview.thumbnailUrl,
      siteName: preview.providerName,
      isVideoEmbed: true,
    };
  }

  const socialVideoFallback = getNonEmbeddableSocialVideoPreview(url);

  const fallback: ShortPostLinkPreview = socialVideoFallback || {
    url,
    title: humanizeUrlTitle(url),
    siteName: getUrlHostLabel(url),
    description: getUrlHostLabel(url),
  };

  // 1) noembed (fast and simple)
  const noembed = await fetchJson(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
  const fromNoembed: ShortPostLinkPreview | null = noembed
    ? {
        url,
        title: pickBestText(noembed?.title, fallback.title) || fallback.title,
        description: pickBestText(noembed?.description, noembed?.author_name, fallback.description),
        imageUrl: pickBestText(noembed?.thumbnail_url),
        siteName: pickBestText(noembed?.provider_name, fallback.siteName),
        isVideoEmbed: false,
        isVideoLinkPreview: fallback.isVideoLinkPreview,
      }
    : null;

  // 2) microlink fallback (better metadata coverage)
  const microlink = await fetchJson(`https://api.microlink.io/?url=${encodeURIComponent(url)}&meta=true&screenshot=true`);
  const microData = microlink?.data && typeof microlink.data === 'object' ? microlink.data : null;
  const fromMicrolink: ShortPostLinkPreview | null = microData
    ? {
        url,
        title: pickBestText(microData?.title, fromNoembed?.title, fallback.title) || fallback.title,
        description: pickBestText(microData?.description, fromNoembed?.description, fallback.description),
        imageUrl: pickBestText(microData?.image?.url, microData?.logo?.url, microData?.screenshot?.url, fromNoembed?.imageUrl),
        siteName: pickBestText(microData?.publisher, fromNoembed?.siteName, fallback.siteName),
        isVideoEmbed: false,
        isVideoLinkPreview: fallback.isVideoLinkPreview,
      }
    : null;

  if (socialVideoFallback) {
    const enriched = fromMicrolink || fromNoembed;
    return {
      ...socialVideoFallback,
      title: pickBestText(enriched?.title, socialVideoFallback.title) || socialVideoFallback.title,
      description: pickBestText(enriched?.description, socialVideoFallback.description),
      imageUrl: enriched?.imageUrl,
      siteName: pickBestText(enriched?.siteName, socialVideoFallback.siteName),
    };
  }

  return fromMicrolink || fromNoembed || fallback;
}

const previewCache = new Map<string, Promise<ShortPostLinkPreview>>();

export function fetchShortPostLinkPreviewCached(url: string): Promise<ShortPostLinkPreview> {
  const key = url.trim();
  if (!key) return Promise.reject(new Error('URL is required'));
  const cached = previewCache.get(key);
  if (cached) return cached;
  const next = fetchShortPostLinkPreview(key)
    .catch(() => ({
      url: key,
      title: humanizeUrlTitle(key),
      siteName: getUrlHostLabel(key),
      isVideoEmbed: false,
      isVideoLinkPreview: getNonEmbeddableSocialVideoPreview(key)?.isVideoLinkPreview,
    }))
    .then((preview) => preview);
  previewCache.set(key, next);
  return next;
}
