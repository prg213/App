import React, { forwardRef, memo, useCallback, useEffect, useRef, useState } from 'react';
import { FocusablePressable } from '@/components/FocusablePressable';
import {
  findNodeHandle,
  Platform,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import { useColors } from '@/hooks/useColors';
import { useIsOnline } from '@/hooks/useIsOnline';
import { useForegroundEpoch } from '@/hooks/useForegroundEpoch';
import { getTmdbPosterUrl } from '@/services/tmdb';

function HighlightedText({ text, query, style, compact }: { text: string; query: string; style: any; compact?: boolean }) {
  const colors = useColors();
  if (!query) return <Text style={style} numberOfLines={2}>{text}</Text>;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: { t: string; m: boolean }[] = [];
  let i = 0;
  while (i < text.length) {
    const idx = lower.indexOf(q, i);
    if (idx === -1) { parts.push({ t: text.slice(i), m: false }); break; }
    if (idx > i) parts.push({ t: text.slice(i, idx), m: false });
    parts.push({ t: text.slice(idx, idx + q.length), m: true });
    i = idx + q.length;
  }
  const hlStyle = { color: colors.primary, fontFamily: compact ? 'Inter_500Medium' : 'Inter_700Bold' };
  return (
    <Text style={style} numberOfLines={2}>
      {parts.map((p, j) => p.m ? <Text key={j} style={hlStyle}>{p.t}</Text> : p.t)}
    </Text>
  );
}

interface MovieCardProps {
  id: string;
  name: string;
  cover?: string;
  rating?: string;
  genre?: string;
  year?: string;
  query?: string;
  isFav?: boolean;
  compact?: boolean;
  /** 0–1 resume progress bar shown at the bottom of the poster */
  progress?: number;
  /**
   * Optional style override for the outer TouchableOpacity wrapper.
   * Use when the card is nested inside a layout container that already
   * controls width (e.g. SwipeToDeleteCard) so the card's own maxWidth
   * doesn't double-constrain it.
   */
  cardStyle?: StyleProp<ViewStyle>;
  onPress: () => void;
  onFavPress?: () => void;
  onLongPress?: () => void;
  /** kept for API compatibility — button no longer rendered on the poster */
  onTrailerPress?: () => void;
  /** TV: called when this card's FocusablePressable receives D-pad focus */
  onFocus?: () => void;
  /**
   * TV-only: when provided, renders a ✕ delete button as a third independently
   * D-pad-focusable zone (RIGHT of the heart, or RIGHT of the card when no
   * heart is present).  Used in the Recently Watched grid to give remote users
   * the same remove-from-history action that touch users get by swiping.
   */
  onTvDeletePress?: () => void;
}

const MovieCardComponent = forwardRef<View, MovieCardProps>(function MovieCardInner(
  { name, cover, rating, genre, year, query = '', isFav, compact, progress, cardStyle, onPress, onFavPress, onLongPress, onFocus, onTvDeletePress },
  ref
) {
  const colors = useColors();
  const isOnline = useIsOnline();
  // #172: increment whenever the app returns to the foreground so images that
  // were evicted from memory (or served broken from a stale cache entry) are
  // remounted cleanly.  Combined with the poster URI it also catches the #165
  // case where the provider serves a fresh cover after a background refetch.
  const fgEpoch = useForegroundEpoch();

  const [tmdbPoster, setTmdbPoster] = useState<string | null>(null);

  // ── TV: independently focusable heart button wiring ───────────────────────
  // cardBodyRef is the primary card focus zone (forwarded so callers can restore
  // focus to this card).  heartRef is the heart/favourite sub-zone.  We wire
  // nextFocusRight card→heart and nextFocusLeft heart→card so D-pad RIGHT
  // reaches the heart even though it is absolutely positioned inside the poster.
  const cardBodyRef = useRef<View>(null);
  const heartRef    = useRef<View>(null);
  const deleteRef   = useRef<View>(null);

  const setCardRef = useCallback((node: View | null) => {
    (cardBodyRef as React.MutableRefObject<View | null>).current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) (ref as React.MutableRefObject<View | null>).current = node;
  }, [ref]);

  // TV: wire the card body → heart → delete zone chain (RIGHT to advance,
  // LEFT to go back) so the remote can reach all three zones.  Falls back to
  // a 2-zone chain when only one secondary zone is present.
  useEffect(() => {
    if (!Platform.isTV || (!onFavPress && !onTvDeletePress)) return;
    const t = setTimeout(() => {
      const cardH   = findNodeHandle(cardBodyRef.current);
      const heartH  = onFavPress      ? findNodeHandle(heartRef.current)  : null;
      const deleteH = onTvDeletePress ? findNodeHandle(deleteRef.current) : null;
      if (!cardH) return;
      if (heartH && deleteH) {
        (cardBodyRef.current as any)?.setNativeProps({ nextFocusRight: heartH  });
        (heartRef.current   as any)?.setNativeProps({ nextFocusLeft:  cardH,  nextFocusRight: deleteH });
        (deleteRef.current  as any)?.setNativeProps({ nextFocusLeft:  heartH  });
      } else if (heartH) {
        (cardBodyRef.current as any)?.setNativeProps({ nextFocusRight: heartH  });
        (heartRef.current   as any)?.setNativeProps({ nextFocusLeft:  cardH   });
      } else if (deleteH) {
        (cardBodyRef.current as any)?.setNativeProps({ nextFocusRight: deleteH });
        (deleteRef.current  as any)?.setNativeProps({ nextFocusLeft:  cardH   });
      }
    }, 100);
    return () => clearTimeout(t);
  }, [onFavPress, onTvDeletePress]);

  useEffect(() => {
    if (cover) { setTmdbPoster(null); return; }
    if (!isOnline) return;
    let cancelled = false;
    getTmdbPosterUrl(name, 'movie').then((url) => {
      if (!cancelled) setTmdbPoster(url);
    });
    return () => { cancelled = true; };
  }, [name, cover, isOnline]);

  const posterUri = cover || tmdbPoster;

  return (
    <FocusablePressable ref={setCardRef} onFocus={onFocus} style={[styles.card, compact && styles.cardCompact, cardStyle]} onPress={onPress} onLongPress={onLongPress} delayLongPress={500} accessibilityLabel={name} accessibilityRole="button">
      {/* Poster */}
      <View style={[styles.poster, { backgroundColor: colors.secondary }]}>
        {posterUri ? (
          <Image source={{ uri: posterUri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" recyclingKey={`${posterUri}-${fgEpoch}`} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.noImage]}>
            <Text style={[styles.noImageIcon, { color: colors.mutedForeground }]}>▶</Text>
          </View>
        )}
        {rating && parseFloat(rating) > 0 && (
          <View style={[styles.ratingBadge, { backgroundColor: 'rgba(0,0,0,0.75)' }]}>
            <Text style={styles.ratingText}>★ {parseFloat(rating).toFixed(1)}</Text>
          </View>
        )}
        {/* Heart favourite button.  On TV it is an independently D-pad-focusable
            zone reached by pressing RIGHT from the card body; LEFT returns to
            the card.  On touch it is not focusable — the card body OK opens
            details, and the heart is tapped directly on the poster overlay. */}
        {onFavPress && (
          <FocusablePressable
            ref={heartRef}
            style={styles.heartBtn}
            focusable={Platform.isTV}
            onPress={(e) => { (e as any).stopPropagation?.(); onFavPress(); }}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Text style={[styles.heartIcon, { color: isFav ? '#EF4444' : 'rgba(255,255,255,0.7)' }]}>
              {isFav ? '♥' : '♡'}
            </Text>
          </FocusablePressable>
        )}
        {/* Resume progress bar */}
        {progress != null && progress > 0 && (
          <View style={styles.progressRail}>
            <View style={[styles.progressFill, { width: `${Math.max(2, Math.min(100, progress * 100))}%` as any }]} />
          </View>
        )}
        {/* TV delete button — third D-pad zone, shown only when onTvDeletePress
            is supplied (e.g. the Recently Watched grid).  Replaces swipe-to-delete
            for remote users. */}
        {Platform.isTV && onTvDeletePress && (
          <FocusablePressable
            ref={deleteRef}
            style={styles.tvDeleteBtn}
            onPress={onTvDeletePress}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.tvDeleteIcon}>✕</Text>
          </FocusablePressable>
        )}
      </View>

      {/* Info */}
      <View style={[styles.info, compact && styles.infoCompact]}>
        <HighlightedText
          text={name}
          query={query}
          compact={compact}
          style={[styles.title, { color: colors.foreground }, compact && styles.titleCompact]}
        />
        {!compact && (genre || year) ? (
          <Text style={[styles.genre, { color: colors.mutedForeground }]} numberOfLines={1}>
            {[genre?.split(',')[0], year ? year.slice(0, 4) : null].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
      </View>
    </FocusablePressable>
  );
});

export const MovieCard = memo(MovieCardComponent);

const styles = StyleSheet.create({
  card: {
    flex: 1,
    maxWidth: '25%',
    padding: 5,
  },
  cardCompact: {
    padding: 3,
  },
  poster: {
    width: '100%',
    aspectRatio: 2 / 3,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  noImage: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  noImageIcon: {
    fontSize: 28,
  },
  ratingBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  ratingText: {
    color: '#F59E0B',
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  heartBtn: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 99,
    width: 26,
    height: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heartIcon: {
    fontSize: 14,
    lineHeight: 16,
  },
  progressRail: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#3B82F6',
    borderRadius: 1.5,
  },
  tvDeleteBtn: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(239,68,68,0.88)',
    borderRadius: 99,
    width: 26,
    height: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tvDeleteIcon: {
    fontSize: 11,
    color: '#fff',
    lineHeight: 13,
    fontFamily: 'Inter_700Bold',
  },
  info: {
    marginTop: 7,
    gap: 3,
    paddingHorizontal: 2,
  },
  infoCompact: {
    marginTop: 4,
  },
  title: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    lineHeight: 18,
  },
  titleCompact: {
    fontSize: 10,
    lineHeight: 13,
  },
  genre: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
});
