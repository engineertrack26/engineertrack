import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { parseMarkdownBlocks } from '@/utils/markdownBlocks';
import { ui } from './workflowStyles';
import { colors } from '@/theme';

interface MarkdownViewProps {
  markdown: string;
}

/** Renders the server-built internship report (docs/superpowers/specs/
 *  2026-09-16-internship-closure-design.md §5) with an in-house block
 *  renderer -- no Markdown library, since the shapes are a closed set
 *  (see parseMarkdownBlocks). Purely presentational: no loading, error or
 *  network concerns belong here. */
export function MarkdownView({ markdown }: MarkdownViewProps) {
  const blocks = parseMarkdownBlocks(markdown);
  return (
    <View style={styles.container}>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'h1':
            return (
              <Text key={i} style={ui.title} accessibilityRole="header">
                {block.text}
              </Text>
            );
          case 'h2':
            return (
              <Text key={i} style={ui.section} accessibilityRole="header">
                {block.text}
              </Text>
            );
          case 'note':
            return (
              <Text key={i} style={[ui.secondary, styles.note]}>
                {block.text}
              </Text>
            );
          case 'table':
            return (
              <ScrollView key={i} horizontal showsHorizontalScrollIndicator style={styles.tableScroll}>
                <View>
                  {(block.rows || []).map((row, r) => (
                    <View key={r} style={styles.row}>
                      {row.map((cell, c) => (
                        <View key={c} style={styles.cell}>
                          <Text style={[ui.body, r === 0 && styles.headerCell]}>{cell}</Text>
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              </ScrollView>
            );
          case 'p':
          default:
            return (
              <Text key={i} style={ui.body}>
                {block.text}
              </Text>
            );
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  note: { fontStyle: 'italic' },
  tableScroll: { marginVertical: 4 },
  row: { flexDirection: 'row' },
  cell: { minWidth: 96, padding: 6, borderWidth: 1, borderColor: colors.divider },
  headerCell: { fontWeight: '700' },
});
