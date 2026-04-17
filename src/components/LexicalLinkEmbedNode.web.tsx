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

export type InsertLexicalLinkEmbedPayload = {
  url: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
};

type SerializedLexicalLinkEmbedNode = {
  type: 'openspace-link-embed';
  version: 1;
  sourceUrl: string;
  title: string;
  description: string;
  imageUrl: string;
  siteName: string;
};

export const INSERT_LEXICAL_LINK_EMBED_COMMAND = createCommand('INSERT_LEXICAL_LINK_EMBED_COMMAND');

function convertFigureElement(domNode: Node) {
  const el = domNode as HTMLElement;
  if ((el.getAttribute('data-os-link-embed') || '').toLowerCase() !== 'true') return null;

  const sourceUrl = el.getAttribute('data-url') || '';
  if (!sourceUrl) return null;

  return {
    node: $createLexicalLinkEmbedNode({
      sourceUrl,
      title: el.getAttribute('data-title') || sourceUrl,
      description: el.getAttribute('data-description') || '',
      imageUrl: el.getAttribute('data-image-url') || '',
      siteName: el.getAttribute('data-site-name') || '',
    }),
  };
}

class LexicalLinkEmbedNode extends DecoratorNode<React.ReactElement> {
  __sourceUrl: string;
  __title: string;
  __description: string;
  __imageUrl: string;
  __siteName: string;

  static getType() {
    return 'openspace-link-embed';
  }

  static clone(node: LexicalLinkEmbedNode) {
    return new LexicalLinkEmbedNode(
      node.__sourceUrl,
      node.__title,
      node.__description,
      node.__imageUrl,
      node.__siteName,
      node.__key
    );
  }

  static importDOM() {
    return {
      figure: () => ({
        conversion: convertFigureElement,
        priority: 3,
      }),
    };
  }

  static importJSON(serializedNode: SerializedLexicalLinkEmbedNode) {
    return $createLexicalLinkEmbedNode({
      sourceUrl: serializedNode.sourceUrl,
      title: serializedNode.title,
      description: serializedNode.description,
      imageUrl: serializedNode.imageUrl,
      siteName: serializedNode.siteName,
    });
  }

  constructor(
    sourceUrl: string,
    title: string,
    description = '',
    imageUrl = '',
    siteName = '',
    key?: string
  ) {
    super(key);
    this.__sourceUrl = sourceUrl;
    this.__title = title;
    this.__description = description;
    this.__imageUrl = imageUrl;
    this.__siteName = siteName;
  }

  exportJSON(): SerializedLexicalLinkEmbedNode {
    return {
      type: 'openspace-link-embed',
      version: 1,
      sourceUrl: this.__sourceUrl,
      title: this.__title,
      description: this.__description,
      imageUrl: this.__imageUrl,
      siteName: this.__siteName,
    };
  }

  exportDOM() {
    const figure = document.createElement('figure');
    figure.setAttribute('data-os-link-embed', 'true');
    figure.setAttribute('data-url', this.__sourceUrl);
    figure.setAttribute('data-title', this.__title || this.__sourceUrl);
    if (this.__description) figure.setAttribute('data-description', this.__description);
    if (this.__imageUrl) figure.setAttribute('data-image-url', this.__imageUrl);
    if (this.__siteName) figure.setAttribute('data-site-name', this.__siteName);

    // Keep a semantic anchor in exported HTML for graceful fallback readers.
    const anchor = document.createElement('a');
    anchor.setAttribute('href', this.__sourceUrl);
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer');
    anchor.textContent = this.__title || this.__sourceUrl;
    figure.appendChild(anchor);

    return { element: figure };
  }

  createDOM(): HTMLElement {
    return document.createElement('span');
  }

  updateDOM(): false {
    return false;
  }

  decorate(): React.ReactElement {
    return (
      <LexicalLinkEmbedComponent
        nodeKey={this.__key}
        sourceUrl={this.__sourceUrl}
        title={this.__title}
        description={this.__description}
        imageUrl={this.__imageUrl}
        siteName={this.__siteName}
      />
    );
  }
}

function LexicalLinkEmbedComponent({
  nodeKey,
  sourceUrl,
  title,
  description,
  imageUrl,
  siteName,
}: {
  nodeKey: string;
  sourceUrl: string;
  title: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
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
          width: 'min(680px, 100%)',
          borderRadius: 12,
          border: `2px solid ${hovered || isSelected ? '#6366F1' : '#CBD5E1'}`,
          background: '#F8FAFC',
          overflow: 'hidden',
          boxSizing: 'border-box',
        }}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={title || sourceUrl}
            draggable={false}
            style={{
              width: 168,
              minWidth: 168,
              maxWidth: '40%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        ) : null}
        <div style={{ flex: 1, minWidth: 0, padding: '10px 12px' }}>
          {siteName ? (
            <div
              style={{
                color: '#64748B',
                fontSize: 11,
                fontWeight: 700,
                marginBottom: 4,
                textTransform: 'uppercase',
              }}
            >
              {siteName}
            </div>
          ) : null}
          <div
            style={{
              color: '#0F172A',
              fontSize: 14,
              fontWeight: 700,
              lineHeight: 1.3,
              marginBottom: description ? 4 : 6,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {title || sourceUrl}
          </div>
          {description ? (
            <div
              style={{
                color: '#475569',
                fontSize: 12,
                lineHeight: 1.35,
                marginBottom: 5,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {description}
            </div>
          ) : null}
          <div
            style={{
              color: '#4F46E5',
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {sourceUrl}
          </div>
        </div>
      </div>
    </div>
  );
}

export function $createLexicalLinkEmbedNode(payload: {
  sourceUrl: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
}) {
  return $applyNodeReplacement(
    new LexicalLinkEmbedNode(
      payload.sourceUrl,
      payload.title || payload.sourceUrl,
      payload.description || '',
      payload.imageUrl || '',
      payload.siteName || ''
    )
  );
}

export function LexicalLinkEmbedsPlugin() {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    const unregisterInsert = editor.registerCommand(
      INSERT_LEXICAL_LINK_EMBED_COMMAND,
      (payload: InsertLexicalLinkEmbedPayload) => {
        editor.update(() => {
          const linkNode = $createLexicalLinkEmbedNode({
            sourceUrl: payload.url,
            title: payload.title,
            description: payload.description,
            imageUrl: payload.imageUrl,
            siteName: payload.siteName,
          });
          $insertNodes([linkNode]);
          $insertNodes([$createParagraphNode()]);
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

export { LexicalLinkEmbedNode };
