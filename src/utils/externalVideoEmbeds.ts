export type ExternalVideoProvider = 'youtube' | 'vimeo';

export type ParsedExternalVideo = {
  provider: ExternalVideoProvider;
  id: string;
  sourceUrl: string;
  embedUrl: string;
};

export type ExternalVideoPreview = {
  title: string;
  thumbnailUrl?: string;
  providerName: string;
};

function normalizeUrl(input: string) {
  return input.trim();
}

function parseYouTubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (host.includes('youtu.be')) {
    return url.pathname.split('/').filter(Boolean)[0] || null;
  }
  if (host.includes('youtube.com')) {
    if (url.pathname.startsWith('/watch')) {
      return url.searchParams.get('v');
    }
    if (url.pathname.startsWith('/shorts/')) {
      return url.pathname.split('/').filter(Boolean)[1] || null;
    }
    if (url.pathname.startsWith('/embed/')) {
      return url.pathname.split('/').filter(Boolean)[1] || null;
    }
  }
  return null;
}

function parseVimeoId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (!host.includes('vimeo.com') && !host.includes('player.vimeo.com')) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (/^\d+$/.test(parts[i])) return parts[i];
  }
  return null;
}

export function parseExternalVideoUrl(rawValue: string): ParsedExternalVideo | null {
  const cleaned = normalizeUrl(rawValue);
  if (!cleaned) return null;

  let url: URL;
  try {
    url = new URL(cleaned);
  } catch {
    return null;
  }

  const youtubeId = parseYouTubeId(url);
  if (youtubeId) {
    return {
      provider: 'youtube',
      id: youtubeId,
      sourceUrl: `https://www.youtube.com/watch?v=${youtubeId}`,
      embedUrl: `https://www.youtube.com/embed/${youtubeId}`,
    };
  }

  const vimeoId = parseVimeoId(url);
  if (vimeoId) {
    return {
      provider: 'vimeo',
      id: vimeoId,
      sourceUrl: `https://vimeo.com/${vimeoId}`,
      embedUrl: `https://player.vimeo.com/video/${vimeoId}`,
    };
  }

  return null;
}

export function getSafeExternalVideoEmbedUrl(value?: string): string | null {
  if (!value) return null;
  const parsed = parseExternalVideoUrl(value);
  return parsed?.embedUrl || null;
}

export async function fetchExternalVideoPreview(sourceUrl: string): Promise<ExternalVideoPreview> {
  const parsed = parseExternalVideoUrl(sourceUrl);
  if (!parsed) {
    throw new Error('Only YouTube and Vimeo URLs are supported right now.');
  }

  const endpoint = parsed.provider === 'youtube'
    ? `https://www.youtube.com/oembed?url=${encodeURIComponent(parsed.sourceUrl)}&format=json`
    : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(parsed.sourceUrl)}`;

  try {
    const response = await fetch(endpoint, { method: 'GET' });
    if (response.ok) {
      const json = await response.json();
      const title = typeof json?.title === 'string' && json.title.trim()
        ? json.title.trim()
        : `${parsed.provider === 'youtube' ? 'YouTube' : 'Vimeo'} video`;
      const thumbnailUrl = typeof json?.thumbnail_url === 'string' ? json.thumbnail_url : undefined;
      return {
        title,
        thumbnailUrl: thumbnailUrl || undefined,
        providerName: parsed.provider === 'youtube' ? 'YouTube' : 'Vimeo',
      };
    }
  } catch {
    // Fallback below.
  }

  return {
    title: `${parsed.provider === 'youtube' ? 'YouTube' : 'Vimeo'} video`,
    thumbnailUrl: parsed.provider === 'youtube' ? `https://i.ytimg.com/vi/${parsed.id}/hqdefault.jpg` : undefined,
    providerName: parsed.provider === 'youtube' ? 'YouTube' : 'Vimeo',
  };
}
