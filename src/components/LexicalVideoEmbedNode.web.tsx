import * as React from 'react';
import {
  $applyNodeReplacement,
  $createParagraphNode,
  $insertNodes,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  DecoratorNode,
} from 'lexical';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import {
  ExternalVideoProvider,
  fetchExternalVideoPreview,
  parseExternalVideoUrl,
} from '../utils/externalVideoEmbeds';

export type InsertLexicalVideoEmbedPayload = {
  url: string;
  title?: string;
  thumbnailUrl?: string;
};

type SerializedLexicalVideoEmbedNode = {
  type: 'openspace-video-embed';
  version: 1;
  sourceUrl: string;
  embedUrl: string;
  provider: ExternalVideoProvider;
  title: string;
  thumbnailUrl: string;
};

export const INSERT_LEXICAL_VIDEO_EMBED_COMMAND = createCommand('INSERT_LEXICAL_VIDEO_EMBED_COMMAND');

async function buildPayload(url: string): Promise<SerializedLexicalVideoEmbedNode> {
  const parsed = parseExternalVideoUrl(url);
  if (!parsed) {
    throw new Error('Please use a valid YouTube or Vimeo link.');
  }

  const preview = await fetchExternalVideoPreview(parsed.sourceUrl);
  return {
    type: 'openspace-video-embed',
    version: 1,
    sourceUrl: parsed.sourceUrl,
    embedUrl: parsed.embedUrl,
    provider: parsed.provider,
    title: preview.title || `${parsed.provider === 'youtube' ? 'YouTube' : 'Vimeo'} video`,
    thumbnailUrl: preview.thumbnailUrl || '',
  };
}

function convertIframeElement(domNode: Node) {
  const iframe = domNode as HTMLIFrameElement;
  const src = iframe.getAttribute('src') || '';
  const source = iframe.getAttribute('data-source-url') || src;
  const parsed = parseExternalVideoUrl(source) || parseExternalVideoUrl(src);
  if (!parsed) return null;

  return {
    node: $createLexicalVideoEmbedNode({
      sourceUrl: source,
      embedUrl: parsed.embedUrl,
      provider: parsed.provider,
      title: iframe.getAttribute('title') || `${parsed.provider === 'youtube' ? 'YouTube' : 'Vimeo'} video`,
      thumbnailUrl: iframe.getAttribute('data-thumbnail-url') || '',
    }),
  };
}

class LexicalVideoEmbedNode extends DecoratorNode<React.ReactElement> {
  __sourceUrl: string;
  __embedUrl: string;
  __provider: ExternalVideoProvider;
  __title: string;
  __thumbnailUrl: string;

  static getType() {
    return 'openspace-video-embed';
  }

  static clone(node: LexicalVideoEmbedNode) {
    return new LexicalVideoEmbedNode(
      node.__sourceUrl,
      node.__embedUrl,
      node.__provider,
      node.__title,
      node.__thumbnailUrl,
      node.__key
    );
  }

  static importDOM() {
    return {
      iframe: () => ({
        conversion: convertIframeElement,
        priority: 2,
      }),
    };
  }

  static importJSON(serializedNode: SerializedLexicalVideoEmbedNode) {
    return $createLexicalVideoEmbedNode(serializedNode);
  }

  constructor(
    sourceUrl: string,
    embedUrl: string,
    provider: ExternalVideoProvider,
    title: string,
    thumbnailUrl = '',
    key?: string
  ) {
    super(key);
    this.__sourceUrl = sourceUrl;
    this.__embedUrl = embedUrl;
    this.__provider = provider;
    this.__title = title;
    this.__thumbnailUrl = thumbnailUrl;
  }

  exportJSON(): SerializedLexicalVideoEmbedNode {
    return {
      type: 'openspace-video-embed',
      version: 1,
      sourceUrl: this.__sourceUrl,
      embedUrl: this.__embedUrl,
      provider: this.__provider,
      title: this.__title,
      thumbnailUrl: this.__thumbnailUrl,
    };
  }

  exportDOM() {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('src', this.__embedUrl);
    iframe.setAttribute('title', this.__title || `${this.__provider} video`);
    iframe.setAttribute('data-source-url', this.__sourceUrl);
    if (this.__thumbnailUrl) iframe.setAttribute('data-thumbnail-url', this.__thumbnailUrl);
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
    iframe.setAttribute('allowfullscreen', 'true');
    iframe.style.width = '100%';
    iframe.style.minHeight = '315px';
    iframe.style.border = '0';
    iframe.style.borderRadius = '12px';
    iframe.style.aspectRatio = '16/9';
    return { element: iframe };
  }

  createDOM(): HTMLElement {
    return document.createElement('span');
  }

  updateDOM(): false {
    return false;
  }

  decorate(): React.ReactElement {
    return (
      <LexicalVideoEmbedComponent
        nodeKey={this.__key}
        sourceUrl={this.__sourceUrl}
        provider={this.__provider}
        title={this.__title}
        thumbnailUrl={this.__thumbnailUrl}
      />
    );
  }
}

function LexicalVideoEmbedComponent({
  nodeKey,
  sourceUrl,
  provider,
  title,
  thumbnailUrl,
}: {
  nodeKey: string;
  sourceUrl: string;
  provider: ExternalVideoProvider;
  title: string;
  thumbnailUrl?: string;
}) {
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);
  const [hovered, setHovered] = React.useState(false);

  return (
    <div
      contentEditable={false}
      style={{ width: '100%', margin: '14px 0' }}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(event) => {
        event.preventDefault();
        if (!isSelected) {
          clearSelection();
          setSelected(true);
        }
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          gap: 12,
          width: 'min(640px, 100%)',
          borderRadius: 12,
          border: `2px solid ${hovered || isSelected ? '#6366F1' : '#CBD5E1'}`,
          background: '#F8FAFC',
          overflow: 'hidden',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            width: 172,
            minWidth: 172,
            maxWidth: '42%',
            aspectRatio: '16 / 9',
            background: '#0F172A',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={title}
              draggable={false}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : null}
          <div
            style={{
              position: 'absolute',
              width: 44,
              height: 44,
              borderRadius: 999,
              background: 'rgba(15,23,42,0.72)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              fontWeight: 700,
            }}
          >
            ▶
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0, padding: '12px 12px 10px 0' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '2px 8px',
              borderRadius: 999,
              border: '1px solid #C7D2FE',
              color: '#4338CA',
              fontSize: 11,
              fontWeight: 700,
              marginBottom: 8,
              textTransform: 'uppercase',
            }}
          >
            {provider === 'youtube' ? 'YouTube' : 'Vimeo'} embed
          </div>
          <div
            style={{
              color: '#0F172A',
              fontSize: 15,
              fontWeight: 700,
              lineHeight: 1.3,
              marginBottom: 6,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {title || `${provider === 'youtube' ? 'YouTube' : 'Vimeo'} video`}
          </div>
          <div
            style={{
              color: '#64748B',
              fontSize: 12,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {sourceUrl}
          </div>
        </div>
      </div>
    </div>
  );
}

export function $createLexicalVideoEmbedNode(payload: {
  sourceUrl: string;
  embedUrl: string;
  provider: ExternalVideoProvider;
  title?: string;
  thumbnailUrl?: string;
}) {
  return $applyNodeReplacement(
    new LexicalVideoEmbedNode(
      payload.sourceUrl,
      payload.embedUrl,
      payload.provider,
      payload.title || `${payload.provider === 'youtube' ? 'YouTube' : 'Vimeo'} video`,
      payload.thumbnailUrl || ''
    )
  );
}

export function $isLexicalVideoEmbedNode(node: unknown): node is LexicalVideoEmbedNode {
  return node instanceof LexicalVideoEmbedNode;
}

export function LexicalVideoEmbedsPlugin() {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    const unregisterInsert = editor.registerCommand(
      INSERT_LEXICAL_VIDEO_EMBED_COMMAND,
      (payload: InsertLexicalVideoEmbedPayload) => {
        void (async () => {
          const parsed = parseExternalVideoUrl(payload.url);
          if (!parsed) throw new Error('Please use a valid YouTube or Vimeo link.');
          const nodePayload = payload.title || payload.thumbnailUrl
            ? {
                type: 'openspace-video-embed' as const,
                version: 1 as const,
                sourceUrl: parsed.sourceUrl,
                embedUrl: parsed.embedUrl,
                provider: parsed.provider,
                title: payload.title || `${parsed.provider === 'youtube' ? 'YouTube' : 'Vimeo'} video`,
                thumbnailUrl: payload.thumbnailUrl || '',
              }
            : await buildPayload(payload.url);
          editor.update(() => {
            const videoNode = $createLexicalVideoEmbedNode({
              sourceUrl: nodePayload.sourceUrl,
              embedUrl: nodePayload.embedUrl,
              provider: nodePayload.provider,
              title: payload.title || nodePayload.title,
              thumbnailUrl: payload.thumbnailUrl || nodePayload.thumbnailUrl,
            });
            $insertNodes([videoNode]);
            $insertNodes([$createParagraphNode()]);
          });
        })().catch((error) => {
          console.error('[LexicalVideoEmbedsPlugin] insert failed', error);
        });
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    );

    return () => {
      unregisterInsert();
    };
  }, [editor]);

  return null;
}

export { LexicalVideoEmbedNode };
