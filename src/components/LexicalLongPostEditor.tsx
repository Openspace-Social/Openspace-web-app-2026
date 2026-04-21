import React from 'react';
import { Platform, Text, View } from 'react-native';

type LexicalLongPostEditorProps = {
  value: string;
  placeholder?: string;
  onChange: (html: string) => void;
  onUploadImageFiles?: (files: Array<Blob & { name?: string; type?: string }>) => Promise<string[]>;
  expandedHeight?: boolean;
  maxImages?: number;
  onNotify?: (message: string) => void;
  token?: string;
};

export default function LexicalLongPostEditor(_: LexicalLongPostEditorProps) {
  if (Platform.OS === 'web') {
    try {
      // Force web implementation even if extension resolution is inconsistent.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const WebEditor = require('./LexicalLongPostEditor.web').default as React.ComponentType<LexicalLongPostEditorProps>;
      return <WebEditor {..._} />;
    } catch (error) {
      console.error('[LexicalLongPostEditor] web load failed', error);
    }
  }

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: '#CBD5E1',
        borderRadius: 12,
        padding: 12,
        backgroundColor: '#F8FAFC',
      }}
    >
      <Text style={{ color: '#64748B' }}>
        {Platform.OS === 'web'
          ? 'Lexical editor did not load.'
          : 'Lexical preview is currently available on web only.'}
      </Text>
    </View>
  );
}
