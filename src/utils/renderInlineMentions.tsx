/**
 * useInlineMentionRenderer
 *
 * Tokenises a plain string into React Native <Text> children, turning
 * @mentions into Profile-screen links and #hashtags into Hashtag-screen
 * links. Use the returned function inside a parent <Text> like:
 *
 *   const renderInline = useInlineMentionRenderer(c);
 *   <Text>{renderInline(block.text)}</Text>
 *
 * Mentions / hashtags must be preceded by start-of-string or whitespace
 * so that "email@domain.com" / "issue#42-comment" don't false-positive.
 * Trailing punctuation (.,!?:;) is preserved as plain text after the
 * link, so "Hi @k61s!" links @k61s without swallowing the bang.
 */
import React, { useCallback } from 'react';
import { Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

const TOKEN_REGEX = /(^|\s)(@[A-Za-z0-9_.]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|@[A-Za-z0-9_.]+|#[A-Za-z0-9_]+)/g;
// Trailing chars to strip from a captured token before treating it as a
// username/hashtag. Common sentence punctuation only.
const TRAILING_PUNCT = /[.,!?:;]+$/;

export function useInlineMentionRenderer(c?: any) {
  const navigation = useNavigation<any>();
  const { token } = useAuth();
  const linkColor = c?.textLink || '#6366F1';

  return useCallback(
    (text: string | undefined | null): React.ReactNode => {
      if (!text) return text ?? '';
      const out: React.ReactNode[] = [];
      let lastIndex = 0;
      let key = 0;
      let match: RegExpExecArray | null;
      // Reset between calls — TOKEN_REGEX has the global flag.
      TOKEN_REGEX.lastIndex = 0;

      while ((match = TOKEN_REGEX.exec(text)) !== null) {
        const leading = match[1];
        const rawToken = match[2];
        const tokenStart = match.index + leading.length;
        const tokenEnd = tokenStart + rawToken.length;

        // Strip trailing punctuation from the captured token; keep the
        // stripped portion as plain text.
        const trailMatch = rawToken.match(TRAILING_PUNCT);
        const trail = trailMatch ? trailMatch[0] : '';
        const token = trail ? rawToken.slice(0, rawToken.length - trail.length) : rawToken;
        if (token.length <= 1) {
          // Was just '@' / '#' followed entirely by punctuation — bail out
          // and let it render as plain text.
          continue;
        }

        // Emit text before the token (including the leading whitespace).
        if (tokenStart > lastIndex) {
          out.push(text.slice(lastIndex, tokenStart));
        }

        const isMention = token.startsWith('@');
        const value = token.slice(1);
        out.push(
          <Text
            key={`mh-${key++}`}
            style={{ color: linkColor }}
            onPress={() => {
              if (isMention) {
                if (value.includes('@') && token) {
                  void api.resolveFederatedDiscoveryEntity(token, `@${value}`)
                    .then((resolved) => {
                      if (resolved.kind === 'actor') {
                        navigation.navigate('RemoteProfile', { remoteActorId: resolved.actor.id });
                      } else {
                        navigation.navigate('Profile', { username: value });
                      }
                    })
                    .catch(() => {
                      navigation.navigate('Profile', { username: value });
                    });
                } else {
                  navigation.navigate('Profile', { username: value });
                }
              } else {
                navigation.navigate('Hashtag', { name: value });
              }
            }}
          >
            {token}
          </Text>,
        );

        // Stripped trailing punctuation goes back as plain text.
        if (trail) out.push(trail);
        lastIndex = tokenEnd;
      }

      if (lastIndex < text.length) {
        out.push(text.slice(lastIndex));
      }
      return out.length === 0 ? text : out;
    },
    [navigation, linkColor, token],
  );
}
