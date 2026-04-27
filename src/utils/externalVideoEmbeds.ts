export type ExternalVideoProvider =
  | 'youtube'
  | 'vimeo'
  | 'twitch'
  | 'soundcloud'
  | 'spotify';

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

// Used as `parent` for Twitch and `origin` for any provider that wants a
// cooperating host. Must match the WebView baseUrl in PostCard /
// PostDetailModal so YouTube + Twitch's referrer checks pass.
const EMBED_PARENT_HOST = 'openspacelive.com';

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

type TwitchTarget =
  | { kind: 'channel'; channel: string }
  | { kind: 'video'; videoId: string }
  | { kind: 'clip'; clipId: string };

function parseTwitchTarget(url: URL): TwitchTarget | null {
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);

  // clips.twitch.tv/CLIPID
  if (host.includes('clips.twitch.tv') && parts[0]) {
    return { kind: 'clip', clipId: parts[0] };
  }
  // m.twitch.tv / www.twitch.tv / twitch.tv
  if (host.endsWith('twitch.tv')) {
    // /videos/123456789
    if (parts[0] === 'videos' && parts[1]) {
      return { kind: 'video', videoId: parts[1] };
    }
    // /CHANNEL/clip/CLIPID
    if (parts[0] && parts[1] === 'clip' && parts[2]) {
      return { kind: 'clip', clipId: parts[2] };
    }
    // /CHANNEL (live)
    if (parts[0]) {
      return { kind: 'channel', channel: parts[0] };
    }
  }
  return null;
}

function parseSoundCloudPath(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (!host.includes('soundcloud.com')) return null;
  // Need user + track segments (or playlist /sets/). Short URLs like
  // on.soundcloud.com need resolving and aren't supported here.
  if (host.startsWith('on.')) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return parts.join('/');
}

type SpotifyTarget = { kind: 'track' | 'album' | 'playlist' | 'episode' | 'show'; id: string };

function parseSpotifyTarget(url: URL): SpotifyTarget | null {
  const host = url.hostname.toLowerCase();
  if (!host.includes('open.spotify.com')) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  // Locale-prefixed URLs: /intl-it/track/ID — strip the locale.
  if (parts[0]?.startsWith('intl-')) parts.shift();
  const kind = parts[0];
  const id = parts[1];
  if (!id) return null;
  if (kind === 'track' || kind === 'album' || kind === 'playlist' || kind === 'episode' || kind === 'show') {
    return { kind, id };
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

  const twitch = parseTwitchTarget(url);
  if (twitch) {
    if (twitch.kind === 'channel') {
      return {
        provider: 'twitch',
        id: twitch.channel,
        sourceUrl: `https://twitch.tv/${twitch.channel}`,
        embedUrl: `https://player.twitch.tv/?channel=${encodeURIComponent(twitch.channel)}&parent=${EMBED_PARENT_HOST}`,
      };
    }
    if (twitch.kind === 'video') {
      return {
        provider: 'twitch',
        id: twitch.videoId,
        sourceUrl: `https://twitch.tv/videos/${twitch.videoId}`,
        embedUrl: `https://player.twitch.tv/?video=${encodeURIComponent(twitch.videoId)}&parent=${EMBED_PARENT_HOST}`,
      };
    }
    return {
      provider: 'twitch',
      id: twitch.clipId,
      sourceUrl: `https://clips.twitch.tv/${twitch.clipId}`,
      embedUrl: `https://clips.twitch.tv/embed?clip=${encodeURIComponent(twitch.clipId)}&parent=${EMBED_PARENT_HOST}`,
    };
  }

  const soundcloudPath = parseSoundCloudPath(url);
  if (soundcloudPath) {
    const sourceUrl = `https://soundcloud.com/${soundcloudPath}`;
    return {
      provider: 'soundcloud',
      id: soundcloudPath,
      sourceUrl,
      embedUrl: `https://w.soundcloud.com/player/?url=${encodeURIComponent(sourceUrl)}&color=%236366f1&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false&visual=true`,
    };
  }

  const spotify = parseSpotifyTarget(url);
  if (spotify) {
    return {
      provider: 'spotify',
      id: spotify.id,
      sourceUrl: `https://open.spotify.com/${spotify.kind}/${spotify.id}`,
      embedUrl: `https://open.spotify.com/embed/${spotify.kind}/${spotify.id}`,
    };
  }

  return null;
}

export function getSafeExternalVideoEmbedUrl(value?: string): string | null {
  if (!value) return null;
  const parsed = parseExternalVideoUrl(value);
  return parsed?.embedUrl || null;
}

const PROVIDER_LABEL: Record<ExternalVideoProvider, string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  twitch: 'Twitch',
  soundcloud: 'SoundCloud',
  spotify: 'Spotify',
};

export async function fetchExternalVideoPreview(sourceUrl: string): Promise<ExternalVideoPreview> {
  const parsed = parseExternalVideoUrl(sourceUrl);
  if (!parsed) {
    throw new Error('Unsupported video URL.');
  }

  const oembedEndpoint =
    parsed.provider === 'youtube'
      ? `https://www.youtube.com/oembed?url=${encodeURIComponent(parsed.sourceUrl)}&format=json`
      : parsed.provider === 'vimeo'
        ? `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(parsed.sourceUrl)}`
        : parsed.provider === 'soundcloud'
          ? `https://soundcloud.com/oembed?url=${encodeURIComponent(parsed.sourceUrl)}&format=json`
          // Twitch + Spotify don't expose a public oembed endpoint; fall through to the default below.
          : null;

  if (oembedEndpoint) {
    try {
      const response = await fetch(oembedEndpoint, { method: 'GET' });
      if (response.ok) {
        const json = await response.json();
        const title = typeof json?.title === 'string' && json.title.trim() ? json.title.trim() : `${PROVIDER_LABEL[parsed.provider]} content`;
        const thumbnailUrl = typeof json?.thumbnail_url === 'string' ? json.thumbnail_url : undefined;
        return {
          title,
          thumbnailUrl: thumbnailUrl || undefined,
          providerName: PROVIDER_LABEL[parsed.provider],
        };
      }
    } catch {
      // Fallback below.
    }
  }

  return {
    title: `${PROVIDER_LABEL[parsed.provider]} content`,
    thumbnailUrl: parsed.provider === 'youtube' ? `https://i.ytimg.com/vi/${parsed.id}/hqdefault.jpg` : undefined,
    providerName: PROVIDER_LABEL[parsed.provider],
  };
}
