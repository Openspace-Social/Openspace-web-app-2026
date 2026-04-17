import * as React from 'react';
import {
  $createParagraphNode,
  $applyNodeReplacement,
  $getNodeByKey,
  $insertNodes,
  $isNodeSelection,
  $isRangeSelection,
  $getSelection,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  DecoratorNode,
} from 'lexical';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';

export type InsertLexicalImagePayload = {
  src: string;
  altText?: string;
  width?: number;
  align?: LexicalImageAlign;
};
export type LexicalImageAlign = 'left' | 'center' | 'right';

export const INSERT_LEXICAL_IMAGE_COMMAND = createCommand('INSERT_LEXICAL_IMAGE_COMMAND');
export const SET_LEXICAL_IMAGE_ALIGN_COMMAND = createCommand('SET_LEXICAL_IMAGE_ALIGN_COMMAND');

type SerializedLexicalImageNode = {
  type: 'openspace-image';
  version: 1;
  src: string;
  altText: string;
  width: number;
  align: LexicalImageAlign;
};

function clampWidth(value: number) {
  if (!Number.isFinite(value)) return 560;
  return Math.max(120, Math.min(1200, Math.round(value)));
}

function inferAlignFromImageElement(node: HTMLImageElement): LexicalImageAlign {
  const dataAlign = (node.getAttribute('data-align') || '').toLowerCase();
  if (dataAlign === 'center' || dataAlign === 'right' || dataAlign === 'left') {
    return dataAlign as LexicalImageAlign;
  }

  const style = node.style;
  const marginLeft = (style.marginLeft || '').trim().toLowerCase();
  const marginRight = (style.marginRight || '').trim().toLowerCase();
  const cssFloat = (style.cssFloat || '').trim().toLowerCase();

  if (marginLeft === 'auto' && marginRight === 'auto') return 'center';
  if (marginLeft === 'auto' && marginRight !== 'auto') return 'right';
  if (marginRight === 'auto' && marginLeft !== 'auto') return 'left';
  if (cssFloat === 'right') return 'right';
  if (cssFloat === 'left') return 'left';
  return 'left';
}

function convertImageElement(domNode: Node) {
  const node = domNode as HTMLImageElement;
  const src = node.getAttribute('src') || '';
  if (!src) return null;
  const altText = node.getAttribute('alt') || '';
  const attrWidth = Number(node.getAttribute('width'));
  const styleWidth = Number.parseInt(node.style.width || '', 10);
  const width = clampWidth(Number.isFinite(attrWidth) && attrWidth > 0 ? attrWidth : styleWidth || 560);
  const align = inferAlignFromImageElement(node);
  return {
    node: $createLexicalImageNode({
      src,
      altText,
      width,
      align: align === 'center' || align === 'right' ? align : 'left',
    }),
  };
}

class LexicalImageNode extends DecoratorNode<React.ReactElement> {
  __src: string;
  __altText: string;
  __width: number;
  __align: LexicalImageAlign;

  static getType() {
    return 'openspace-image';
  }

  static clone(node: LexicalImageNode) {
    return new LexicalImageNode(node.__src, node.__altText, node.__width, node.__align, node.__key);
  }

  static importDOM() {
    return {
      img: () => ({
        conversion: convertImageElement,
        priority: 1,
      }),
    };
  }

  static importJSON(serializedNode: SerializedLexicalImageNode) {
    return $createLexicalImageNode({
      src: serializedNode.src,
      altText: serializedNode.altText,
      width: serializedNode.width,
      align: serializedNode.align,
    });
  }

  constructor(src: string, altText = '', width = 560, align: LexicalImageAlign = 'left', key?: string) {
    super(key);
    this.__src = src;
    this.__altText = altText;
    this.__width = clampWidth(width);
    this.__align = align;
  }

  exportJSON(): SerializedLexicalImageNode {
    return {
      type: 'openspace-image',
      version: 1,
      src: this.__src,
      altText: this.__altText,
      width: this.__width,
      align: this.__align,
    };
  }

  exportDOM() {
    const img = document.createElement('img');
    img.setAttribute('src', this.__src);
    img.setAttribute('alt', this.__altText);
    img.setAttribute('width', String(this.__width));
    img.setAttribute('data-align', this.__align);
    img.style.width = `${this.__width}px`;
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
    img.style.display = 'block';
    img.style.cssFloat = 'none';
    if (this.__align === 'center') {
      img.style.marginLeft = 'auto';
      img.style.marginRight = 'auto';
    } else if (this.__align === 'right') {
      img.style.marginLeft = 'auto';
      img.style.marginRight = '0';
    } else {
      img.style.marginLeft = '0';
      img.style.marginRight = 'auto';
    }
    return { element: img };
  }

  createDOM(): HTMLElement {
    return document.createElement('span');
  }

  updateDOM(): false {
    return false;
  }

  setWidth(nextWidth: number) {
    const writable = this.getWritable();
    writable.__width = clampWidth(nextWidth);
  }

  setAlign(nextAlign: LexicalImageAlign) {
    const writable = this.getWritable();
    writable.__align = nextAlign;
  }

  decorate(): React.ReactElement {
    return (
      <LexicalImageComponent
        nodeKey={this.__key}
        src={this.__src}
        altText={this.__altText}
        width={this.__width}
        align={this.__align}
      />
    );
  }
}

function LexicalImageComponent({
  nodeKey,
  src,
  altText,
  width,
  align,
}: {
  nodeKey: string;
  src: string;
  altText: string;
  width: number;
  align: LexicalImageAlign;
}) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);
  const [showControls, setShowControls] = React.useState(false);
  const resizeStartRef = React.useRef<{ x: number; width: number; direction: 1 | -1 } | null>(null);
  const resizeRafRef = React.useRef<number | null>(null);

  const updateWidth = React.useCallback((nextWidth: number) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isLexicalImageNode(node)) {
        node.setWidth(nextWidth);
      }
    });
  }, [editor, nodeKey]);

  const updateAlign = React.useCallback((nextAlign: LexicalImageAlign) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isLexicalImageNode(node)) {
        node.setAlign(nextAlign);
      }
    });
  }, [editor, nodeKey]);

  const stopResize = React.useCallback(() => {
    resizeStartRef.current = null;
    setShowControls(true);
    if (resizeRafRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(resizeRafRef.current);
      resizeRafRef.current = null;
    }
    window.removeEventListener('pointermove', onPointerMove as any);
    window.removeEventListener('pointerup', onPointerUp as any);
  }, []);

  const onPointerMove = React.useCallback((event: PointerEvent) => {
    const start = resizeStartRef.current;
    if (!start) return;
    event.preventDefault();
    const deltaX = event.clientX - start.x;
    const nextWidth = start.width + deltaX * start.direction;
    if (resizeRafRef.current !== null) return;
    resizeRafRef.current = window.requestAnimationFrame(() => {
      resizeRafRef.current = null;
      updateWidth(nextWidth);
    });
  }, [updateWidth]);

  const onPointerUp = React.useCallback(() => {
    stopResize();
  }, [stopResize]);

  const startResize = React.useCallback((event: React.PointerEvent, direction: 1 | -1) => {
    event.preventDefault();
    event.stopPropagation();
    resizeStartRef.current = {
      x: event.clientX,
      width,
      direction,
    };
    window.addEventListener('pointermove', onPointerMove as any);
    window.addEventListener('pointerup', onPointerUp as any);
  }, [onPointerMove, onPointerUp, width]);

  React.useEffect(() => {
    return () => {
      stopResize();
    };
  }, [stopResize]);

  return (
    <div
      contentEditable={false}
      style={{
        width: '100%',
        display: 'flex',
        justifyContent:
          align === 'center'
            ? 'center'
            : align === 'right'
              ? 'flex-end'
              : 'flex-start',
        margin: '14px 0',
      }}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => {
        if (!resizeStartRef.current) {
          setShowControls(false);
        }
      }}
      onClick={(event) => {
        event.preventDefault();
        setShowControls(true);
        if (!isSelected) {
          clearSelection();
          setSelected(true);
        }
      }}
    >
      <div
        style={{
          position: 'relative',
          display: 'inline-block',
          width: 'fit-content',
          maxWidth: '100%',
        }}
      >
        <img
          src={src}
          alt={altText}
          draggable={false}
          style={{
            width: `${width}px`,
            maxWidth: '100%',
            height: 'auto',
            borderRadius: 10,
            boxSizing: 'border-box',
            border: `2px solid ${showControls || isSelected ? '#6366F1' : '#CBD5E1'}`,
            display: 'block',
          }}
        />
        {showControls || isSelected ? (
          <>
            <div
              style={{
                position: 'absolute',
                left: 10,
                top: 10,
                display: 'flex',
                gap: 4,
                background: 'rgba(15,23,42,0.75)',
                borderRadius: 8,
                padding: 4,
                zIndex: 4,
              }}
            >
              {([
                { key: 'left', label: 'L' },
                { key: 'center', label: 'C' },
                { key: 'right', label: 'R' },
              ] as const).map((option) => (
                <button
                  key={`align-${option.key}`}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => updateAlign(option.key)}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    border: `1px solid ${align === option.key ? '#6366F1' : '#94A3B8'}`,
                    background: align === option.key ? '#E0E7FF' : '#F8FAFC',
                    color: '#0F172A',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    padding: 0,
                    lineHeight: '20px',
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div style={{ ...resizeHandleStyle, left: -6, top: -6, cursor: 'nwse-resize' }} onPointerDown={(event) => startResize(event, -1)} />
            <div style={{ ...resizeHandleStyle, right: -6, top: -6, cursor: 'nesw-resize' }} onPointerDown={(event) => startResize(event, 1)} />
            <div style={{ ...resizeHandleStyle, left: -6, bottom: -6, cursor: 'nesw-resize' }} onPointerDown={(event) => startResize(event, -1)} />
            <div style={{ ...resizeHandleStyle, right: -6, bottom: -6, cursor: 'nwse-resize' }} onPointerDown={(event) => startResize(event, 1)} />
            <div
              style={{
                position: 'absolute',
                right: 10,
                bottom: 10,
                background: 'rgba(15,23,42,0.75)',
                color: '#E2E8F0',
                borderRadius: 8,
                padding: '2px 6px',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {width}px
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

const resizeHandleStyle: React.CSSProperties = {
  position: 'absolute',
  width: 12,
  height: 12,
  borderRadius: 999,
  border: '2px solid #6366F1',
  background: '#FFFFFF',
  zIndex: 3,
};

export function $createLexicalImageNode(payload: InsertLexicalImagePayload) {
  return $applyNodeReplacement(
    new LexicalImageNode(payload.src, payload.altText || '', payload.width || 560, payload.align || 'left')
  );
}

export function $isLexicalImageNode(node: unknown): node is LexicalImageNode {
  return node instanceof LexicalImageNode;
}

export function LexicalImagesPlugin() {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    const unregisterInsert = editor.registerCommand(
      INSERT_LEXICAL_IMAGE_COMMAND,
      (payload: InsertLexicalImagePayload) => {
        editor.update(() => {
          const imageNode = $createLexicalImageNode(payload);
          $insertNodes([imageNode]);
          const rootParagraph = $createParagraphNode();
          $insertNodes([rootParagraph]);
        });
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    );
    const unregisterAlign = editor.registerCommand(
      SET_LEXICAL_IMAGE_ALIGN_COMMAND,
      (payload: LexicalImageAlign) => {
        let handled = false;
        editor.update(() => {
          const selection = $getSelection();
          if ($isNodeSelection(selection)) {
            for (const node of selection.getNodes()) {
              if ($isLexicalImageNode(node)) {
                node.setAlign(payload);
                handled = true;
              }
            }
            return;
          }

          if ($isRangeSelection(selection)) {
            const anchorNode = selection.anchor.getNode();
            const candidate = $isLexicalImageNode(anchorNode) ? anchorNode : anchorNode.getParent();
            if ($isLexicalImageNode(candidate)) {
              candidate.setAlign(payload);
              handled = true;
            }
          }
        });
        return handled;
      },
      COMMAND_PRIORITY_EDITOR
    );

    return () => {
      unregisterInsert();
      unregisterAlign();
    };
  }, [editor]);

  return null;
}

export { LexicalImageNode };
