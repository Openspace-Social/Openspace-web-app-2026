/**
 * LinkifyText — renders a plain string with tappable URLs, @mentions,
 * #hashtags and c/community references. Shared by surfaces that show
 * free-text the user wrote but that aren't posts (profile bio, community
 * description / rules).
 *
 * Presentational only: navigation is delegated to the optional onPress*
 * callbacks. A token whose callback is omitted renders as plain text, so
 * the same component degrades gracefully on surfaces (e.g. the unauthed
 * landing page) where some destinations don't exist.
 *
 * The tokenizer mirrors PostCard's extractTextSegmentsWithLinks so links
 * behave identically here and in post bodies.
 */

import React from 'react';
import { Text, type StyleProp, type TextStyle, type TextLayoutEventData, type NativeSyntheticEvent } from 'react-native';

type Props = {
  text: string;
  style?: StyleProp<TextStyle>;
  /** Colour for the tappable segments. Defaults to the shared link indigo. */
  linkColor?: string;
  numberOfLines?: number;
  onTextLayout?: (e: NativeSyntheticEvent<TextLayoutEventData>) => void;
  onPressMention?: (username: string) => void;
  onPressHashtag?: (tag: string) => void;
  onPressLink?: (url: string) => void;
  onPressCommunity?: (name: string) => void;
};

// URLs first (so a c/ or @ inside a URL is consumed by it), then federated
// mentions (`@user@host.com`), then plain email addresses (so the @-name
// regex doesn't snip off the local-part and treat `@example.com` as a
// fake mention), then local @mentions, #hashtags, and c/community refs.
// The c/ token requires a word boundary before it so "abc/def" / paths
// don't false-positive.
//
// Local @mention pattern allows internal dots — `@user.name`, `@a.b.c` —
// so usernames with dots (which the server-side username_characters_validator
// allows) tokenise as ONE mention rather than truncating at the first dot
// and leaving `.name` as plain text. The `(?:\.[A-Za-z0-9_]+)*` tail
// requires alphanumeric/underscore on both sides of every dot, so a
// trailing sentence dot (`Hi @bob.`) doesn't get gobbled into the link.
//
// Email pattern is standard RFC-5322ish: local-part allows
// alnum/._%+-, then @, then domain labels separated by `.` ending in a
// 2+ letter TLD. Sitting AFTER the federated-mention rule (which starts
// with `@`) means `@user@host.com` is still recognised as a federated
// mention; ordinary `user@host.com` falls through to here and tokenises
// as ONE plain-text span instead of being chopped in half by the local
// @mention rule.
const TOKEN_REGEX = /(https?:\/\/[^\s]+)|(@[A-Za-z0-9_.]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})|(@[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)|(#[A-Za-z]\w*)|(\bc\/[A-Za-z0-9_]+)/gi;

type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; url: string }
  | { kind: 'mention'; text: string; username: string }
  | { kind: 'hashtag'; text: string; tag: string }
  | { kind: 'community'; text: string; name: string };

function tokenize(text: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;
  TOKEN_REGEX.lastIndex = 0;

  while ((match = TOKEN_REGEX.exec(text)) !== null) {
    const start = match.index;
    if (start > lastIndex) {
      segments.push({ kind: 'text', text: text.slice(lastIndex, start) });
    }

    if (match[1]) {
      // URL — strip trailing sentence punctuation back out as plain text.
      const rawUrl = match[1];
      const trimmedUrl = rawUrl.replace(/[),.;!?]+$/g, '');
      const trailing = rawUrl.slice(trimmedUrl.length);
      segments.push({ kind: 'link', text: trimmedUrl, url: trimmedUrl });
      if (trailing) segments.push({ kind: 'text', text: trailing });
    } else if (match[2]) {
      // Federated mention `@user@host.com`.
      segments.push({ kind: 'mention', text: match[2], username: match[2].slice(1) });
    } else if (match[3]) {
      // Email — render as plain text. We deliberately don't make these
      // tappable (mailto:) yet; the immediate fix is just to STOP the
      // local-@mention rule from chopping the address in half.
      segments.push({ kind: 'text', text: match[3] });
    } else if (match[4]) {
      // Local @mention.
      segments.push({ kind: 'mention', text: match[4], username: match[4].slice(1) });
    } else if (match[5]) {
      segments.push({ kind: 'hashtag', text: match[5], tag: match[5].slice(1) });
    } else if (match[6]) {
      // Strip the "c/" prefix (2 chars) to get the community name.
      segments.push({ kind: 'community', text: match[6], name: match[6].slice(2) });
    }

    lastIndex = start + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ kind: 'text', text: text.slice(lastIndex) });
  }
  return segments;
}

export default function LinkifyText({
  text,
  style,
  linkColor = '#6366F1',
  numberOfLines,
  onTextLayout,
  onPressMention,
  onPressHashtag,
  onPressLink,
  onPressCommunity,
}: Props) {
  const segments = React.useMemo(() => tokenize(text || ''), [text]);

  return (
    <Text style={style} numberOfLines={numberOfLines} onTextLayout={onTextLayout}>
      {segments.map((segment, index) => {
        if (segment.kind === 'link' && onPressLink) {
          return (
            <Text key={index} style={{ color: linkColor }} onPress={() => onPressLink(segment.url)}>
              {segment.text}
            </Text>
          );
        }
        if (segment.kind === 'mention' && onPressMention) {
          return (
            <Text
              key={index}
              style={{ color: linkColor }}
              onPress={() => onPressMention(segment.username)}
            >
              {segment.text}
            </Text>
          );
        }
        if (segment.kind === 'hashtag' && onPressHashtag) {
          return (
            <Text key={index} style={{ color: linkColor }} onPress={() => onPressHashtag(segment.tag)}>
              {segment.text}
            </Text>
          );
        }
        if (segment.kind === 'community' && onPressCommunity) {
          return (
            <Text
              key={index}
              style={{ color: linkColor }}
              onPress={() => onPressCommunity(segment.name)}
            >
              {segment.text}
            </Text>
          );
        }
        return <Text key={index}>{segment.text}</Text>;
      })}
    </Text>
  );
}
