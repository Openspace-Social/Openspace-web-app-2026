/**
 * GifPickerProvider — app-level Giphy search modal.
 *
 * Exposes a single hook, `useGifPicker()`, that returns an `open()` function
 * resolving to the picked GIF URL (or null on cancel). The modal mounts
 * once at the app root so any caller — comment composer, reply composer,
 * future post composer — can trigger it without prop-drilling.
 *
 * Search hits Giphy's public REST API directly from the client. The key
 * lives in `EXPO_PUBLIC_GIPHY_KEY` (compiled into the JS bundle); Giphy's
 * free tier is per-key quota, no billing, so it's safe to ship in-app.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';

type Resolver = (url: string | null) => void;

type GiphyItem = {
  id: string;
  url: string;        // full-size animated GIF (what we send as gif_url)
  preview: string;    // small still / animated preview for the grid
  width: number;
  height: number;
};

type Ctx = {
  open: () => Promise<string | null>;
  // Internal state surface used by <GifPickerOverlay /> instances. Multiple
  // overlays can mount (e.g. one at app root, one inside PostDetailModal)
  // — they all read the same state, so they show the same UI; only the
  // topmost-painted one is visible to the user.
  visible: boolean;
  query: string;
  setQuery: (q: string) => void;
  items: GiphyItem[];
  loading: boolean;
  error: string | null;
  finish: (url: string | null) => void;
};

const GifPickerContext = createContext<Ctx | null>(null);

const GIPHY_KEY: string =
  (process.env as any)?.EXPO_PUBLIC_GIPHY_KEY ||
  (globalThis as any)?.process?.env?.EXPO_PUBLIC_GIPHY_KEY ||
  '';

const ENDPOINT_TRENDING = 'https://api.giphy.com/v1/gifs/trending';
const ENDPOINT_SEARCH = 'https://api.giphy.com/v1/gifs/search';

function parseGiphyResponse(json: any): GiphyItem[] {
  const data = Array.isArray(json?.data) ? json.data : [];
  const items: GiphyItem[] = [];
  for (const entry of data) {
    const id = String(entry?.id || '');
    const images = entry?.images || {};
    // Full URL — what we send as gif_url. Prefer downsized over original
    // so feeds aren't loading multi-MB GIFs per attachment.
    const fullSrc =
      images?.downsized?.url ||
      images?.downsized_large?.url ||
      images?.fixed_width?.url ||
      images?.original?.url ||
      '';
    // Preview — used in the picker grid only. Prefer the smallest variants
    // so 12 tiles don't hammer the device on first paint.
    const previewSrc =
      images?.fixed_width_downsampled?.url ||
      images?.fixed_width_small_still?.url ||
      images?.preview_gif?.url ||
      images?.fixed_width_small?.url ||
      images?.fixed_width?.url ||
      fullSrc;
    if (!id || !fullSrc || !previewSrc) continue;
    const w = Number(images?.fixed_width?.width || images?.original?.width || 200);
    const h = Number(images?.fixed_width?.height || images?.original?.height || 200);
    items.push({
      id,
      url: fullSrc,
      preview: previewSrc,
      width: Number.isFinite(w) && w > 0 ? w : 200,
      height: Number.isFinite(h) && h > 0 ? h : 200,
    });
  }
  return items;
}

export function GifPickerProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;

  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<GiphyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolverRef = useRef<Resolver | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeqRef = useRef(0);

  const open = useCallback((): Promise<string | null> => {
    Keyboard.dismiss();
    return new Promise<string | null>((resolve) => {
      resolverRef.current = resolve;
      setQuery('');
      setItems([]);
      setError(null);
      setVisible(true);
    });
  }, []);

  const finish = useCallback((url: string | null) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setVisible(false);
    // Clear results so the next open starts fresh; do this after the resolver
    // fires so pickers that re-open immediately don't see stale state.
    setQuery('');
    setItems([]);
    if (resolve) resolve(url);
  }, []);

  // Run trending or search whenever the modal is open + query changes.
  // Debounced so typing doesn't hammer the API.
  useEffect(() => {
    if (!visible) return;
    if (!GIPHY_KEY) {
      setError(
        t('gifPicker.missingKey', {
          defaultValue: 'GIF search is not configured (missing EXPO_PUBLIC_GIPHY_KEY).',
        }),
      );
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const seq = ++searchSeqRef.current;
    setLoading(true);
    setError(null);
    debounceRef.current = setTimeout(async () => {
      try {
        const trimmed = query.trim();
        const params = new URLSearchParams();
        params.set('api_key', GIPHY_KEY);
        // Smaller batches keep first paint fast on phones — the user can
        // scroll for more if we add pagination later.
        params.set('limit', '12');
        params.set('rating', 'pg-13');
        if (trimmed) params.set('q', trimmed);
        const url = `${trimmed ? ENDPOINT_SEARCH : ENDPOINT_TRENDING}?${params.toString()}`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Giphy ${resp.status}`);
        const json = await resp.json();
        if (seq !== searchSeqRef.current) return; // stale response
        setItems(parseGiphyResponse(json));
      } catch (e: any) {
        if (seq !== searchSeqRef.current) return;
        setError(e?.message || 'Could not load GIFs.');
        setItems([]);
      } finally {
        if (seq === searchSeqRef.current) setLoading(false);
      }
    }, query.trim() ? 280 : 0);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [visible, query, t]);

  const ctxValue = useMemo<Ctx>(
    () => ({ open, visible, query, setQuery, items, loading, error, finish }),
    [open, visible, query, items, loading, error, finish],
  );

  return (
    <GifPickerContext.Provider value={ctxValue}>
      {children}
      {/* Default overlay — renders at provider level for inline screens
       *  (Feed / Profile / Communities). Screens that present a native iOS
       *  Modal (e.g. PostDetailModal) must mount their own <GifPickerOverlay />
       *  inside the modal's content tree so the absolute view paints on top
       *  of the modal — an absolute view at provider level is rendered behind
       *  any natively-presented Modal regardless of zIndex. */}
      <GifPickerOverlay />
    </GifPickerContext.Provider>
  );
}

/**
 * GifPickerOverlay — the picker UI itself. Reads state from
 * `useGifPicker()`; renders an absolute-positioned full-screen overlay when
 * `visible` is true. Mount one wherever the picker needs to appear: at the
 * provider level for normal screens, and again INSIDE any native iOS Modal
 * the user may have open at the time of opening the picker.
 */
export function GifPickerOverlay() {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;
  const ctx = useContext(GifPickerContext);
  if (!ctx) return null;
  const { visible, query, setQuery, items, loading, error, finish } = ctx;

  const screenWidth = Dimensions.get('window').width;
  // Drawer mode — slides in from the right, capped at 380px on wide
  // screens, otherwise leaves a 48px gutter for the dimmed backdrop.
  const drawerWidth = Math.min(380, Math.max(280, screenWidth - 48));
  const tileSize = Math.floor((drawerWidth - 32 - 8) / 2);

  if (!visible) return null;

  return (
    <View
      pointerEvents="auto"
      style={[StyleSheet.absoluteFill, { zIndex: 9999, elevation: 9999, flexDirection: 'row' }]}
    >
      {/* Backdrop — tap-to-close, dims the rest of the app. */}
      <TouchableOpacity
        activeOpacity={1}
        onPress={() => finish(null)}
        style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]}
      />
      {/* Drawer — fixed-width panel on the right. The flexDirection: 'row'
       *  on the outer view + this spacer pushes the drawer to the right
       *  edge without needing absolute positioning math. */}
      <View style={{ flex: 1 }} pointerEvents="none" />
      <View
        style={{
          width: drawerWidth,
          backgroundColor: c.background,
          borderLeftWidth: 1,
          borderLeftColor: c.border,
          shadowColor: '#000',
          shadowOpacity: 0.2,
          shadowRadius: 12,
          shadowOffset: { width: -4, height: 0 },
          elevation: 16,
        }}
      >
      <View style={[styles.header, { borderBottomColor: c.border, backgroundColor: c.surface, paddingTop: Platform.OS === 'ios' ? 50 : 12 }]}>
        <View style={[styles.searchWrap, { backgroundColor: c.inputBackground, borderColor: c.inputBorder }]}>
          <MaterialCommunityIcons name="magnify" size={18} color={c.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: c.textPrimary }]}
            placeholder={t('gifPicker.searchPlaceholder', { defaultValue: 'Search GIFs…' })}
            placeholderTextColor={c.textMuted}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {query.length > 0 ? (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialCommunityIcons name="close-circle" size={16} color={c.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
        <TouchableOpacity
          onPress={() => finish(null)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={[styles.closeBtn, { backgroundColor: c.inputBackground }]}
          activeOpacity={0.85}
        >
          <MaterialCommunityIcons name="close" size={18} color={c.textPrimary} />
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={styles.statusWrap}>
          <Text style={{ color: c.errorText, textAlign: 'center' }}>{error}</Text>
        </View>
      ) : null}

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={2}
        renderItem={({ item }) => (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => finish(item.url)}
            style={[styles.tile, { width: tileSize, height: tileSize, backgroundColor: c.inputBackground }]}
          >
            <Image source={{ uri: item.preview }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          </TouchableOpacity>
        )}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        columnWrapperStyle={{ gap: 8 }}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={6}
        maxToRenderPerBatch={4}
        windowSize={3}
        removeClippedSubviews
        ListEmptyComponent={
          loading ? (
            <View style={styles.statusWrap}>
              <ActivityIndicator color={c.primary} />
            </View>
          ) : !error ? (
            <View style={styles.statusWrap}>
              <Text style={{ color: c.textMuted, textAlign: 'center' }}>
                {t('gifPicker.noResults', { defaultValue: 'No GIFs found.' })}
              </Text>
            </View>
          ) : null
        }
      />

      <View style={[styles.attribution, { borderTopColor: c.border, backgroundColor: c.surface }]}>
        <Text style={{ color: c.textMuted, fontSize: 11 }}>
          {t('gifPicker.poweredBy', { defaultValue: 'Powered by GIPHY' })}
        </Text>
      </View>
      </View>
    </View>
  );
}

// Public hook — callers only need `open()`, never the internal state.
export function useGifPicker(): Pick<Ctx, 'open'> {
  const ctx = useContext(GifPickerContext);
  if (!ctx) {
    // Soft-fail: callers can still attempt to open and get null, which the
    // existing flow treats as cancel. This avoids crashes if the provider
    // hasn't been mounted somewhere in the tree (e.g. during tests).
    return { open: async () => null };
  }
  return ctx;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tile: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  statusWrap: { padding: 32, alignItems: 'center', justifyContent: 'center' },
  attribution: {
    paddingVertical: 8,
    alignItems: 'center',
    borderTopWidth: 1,
  },
});
