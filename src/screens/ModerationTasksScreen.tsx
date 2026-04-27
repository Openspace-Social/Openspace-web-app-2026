/**
 * ModerationTasksScreen — superuser-only list of moderation queue items
 * (Pending / Approved / Rejected) with tap-to-detail and inline approve /
 * reject / verify actions. Mirrors the web drawer (HomeScreen.tsx ~6454)
 * but as a native stack screen with a bottom-sheet detail modal.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { api, GlobalModeratedObject, ModeratedObjectReport } from '../api/client';

type Status = 'P' | 'A' | 'R';
type ModAction = 'approve' | 'reject' | 'verify';

type Props = {
  token: string;
  c: any;
  t: (key: string, options?: any) => string;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
};

function typeLabelOf(item: GlobalModeratedObject) {
  switch (item.object_type) {
    case 'P': return 'Post';
    case 'PC': return 'Comment';
    case 'C': return 'Community';
    case 'U': return 'User';
    default: return 'Hashtag';
  }
}

function severityColorOf(severity?: string) {
  if (severity === 'C') return '#dc2626';
  if (severity === 'H') return '#ea580c';
  if (severity === 'M') return '#ca8a04';
  return '#16a34a';
}

function authorOf(item: GlobalModeratedObject) {
  const co = item.content_object;
  return co?.creator?.username || co?.commenter?.username || co?.username || '';
}

function contentTextOf(item: GlobalModeratedObject) {
  const co = item.content_object;
  return co?.text || co?.name || co?.title || '';
}

export default function ModerationTasksScreen({ token, c, t, onError, onNotice }: Props) {
  const [status, setStatus] = useState<Status>('P');
  const [items, setItems] = useState<GlobalModeratedObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const [detailItem, setDetailItem] = useState<GlobalModeratedObject | null>(null);
  const [detailReports, setDetailReports] = useState<ModeratedObjectReport[]>([]);
  const [detailReportsLoading, setDetailReportsLoading] = useState(false);

  const load = useCallback(async (next: Status, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const fresh = await api.getGlobalModeratedObjects(token, { count: 20, statuses: [next] });
      setItems(Array.isArray(fresh) ? fresh : []);
    } catch (e: any) {
      onError(e?.message || t('home.moderationLoadFailed', { defaultValue: 'Could not load moderation queue.' }));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [token, onError, t]);

  useEffect(() => { void load(status, false); }, [load, status]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(status, true); } finally { setRefreshing(false); }
  }, [load, status]);

  const openDetail = useCallback(async (item: GlobalModeratedObject) => {
    setDetailItem(item);
    setDetailReports([]);
    setDetailReportsLoading(true);
    try {
      const reports = await api.getModeratedObjectReports(token, item.id);
      setDetailReports(Array.isArray(reports) ? reports : []);
    } catch {
      // keep what we have
    } finally {
      setDetailReportsLoading(false);
    }
  }, [token]);

  const closeDetail = useCallback(() => {
    setDetailItem(null);
    setDetailReports([]);
  }, []);

  const handleAction = useCallback(async (id: number, action: ModAction) => {
    setActionLoading(id);
    try {
      if (action === 'approve') await api.approveModeratedObject(token, id);
      else if (action === 'reject') await api.rejectModeratedObject(token, id);
      else await api.verifyModeratedObject(token, id);
      setItems((prev) => prev.filter((row) => row.id !== id));
      if (detailItem?.id === id) setDetailItem(null);
      const noticeKey = action === 'approve' ? 'home.modTasksApprovedNotice'
        : action === 'reject' ? 'home.modTasksRejectedNotice'
        : 'home.modTasksVerifiedNotice';
      const fallback = action === 'approve' ? 'Report approved.'
        : action === 'reject' ? 'Report rejected.'
        : 'Report verified.';
      onNotice(t(noticeKey, { defaultValue: fallback }));
    } catch (e: any) {
      onError(e?.message || t('home.moderationActionFailed', { defaultValue: 'Action failed. Try again.' }));
    } finally {
      setActionLoading(null);
    }
  }, [token, detailItem?.id, onError, onNotice, t]);

  const renderRow = useCallback(({ item }: { item: GlobalModeratedObject }) => {
    const isActioning = actionLoading === item.id;
    const author = authorOf(item);
    const text = contentTextOf(item);
    const sevColor = severityColorOf(item.category?.severity);

    return (
      <TouchableOpacity
        activeOpacity={0.75}
        onPress={() => void openDetail(item)}
        style={[styles.row, { backgroundColor: c.inputBackground, borderColor: c.border }]}
      >
        <View style={styles.rowHeader}>
          <View style={[styles.typeBadge, { backgroundColor: sevColor }]}>
            <Text style={styles.typeBadgeText}>{typeLabelOf(item)}</Text>
          </View>
          {item.category ? (
            <Text style={[styles.categoryText, { color: c.textMuted }]} numberOfLines={1}>
              {item.category.title || item.category.name}
            </Text>
          ) : <View style={{ flex: 1 }} />}
          <Text style={[styles.reportCount, { color: c.textMuted }]}>
            {item.reports_count} {item.reports_count === 1
              ? t('home.modTasksReportSingular', { defaultValue: 'report' })
              : t('home.modTasksReportPlural', { defaultValue: 'reports' })}
          </Text>
        </View>

        {author ? (
          <Text style={[styles.author, { color: c.textSecondary }]}>@{author}</Text>
        ) : null}
        {text ? (
          <Text style={[styles.preview, { color: c.textSecondary }]} numberOfLines={2}>{text}</Text>
        ) : null}

        <View style={styles.actionsRow}>
          {isActioning ? (
            <ActivityIndicator color={c.primary} size="small" />
          ) : item.status === 'P' ? (
            <>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#16a34a' }]}
                activeOpacity={0.85}
                onPress={() => void handleAction(item.id, 'approve')}
              >
                <Text style={styles.actionBtnText}>
                  {t('home.modTasksApproveBtn', { defaultValue: 'Approve' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#dc2626' }]}
                activeOpacity={0.85}
                onPress={() => void handleAction(item.id, 'reject')}
              >
                <Text style={styles.actionBtnText}>
                  {t('home.modTasksRejectBtn', { defaultValue: 'Reject' })}
                </Text>
              </TouchableOpacity>
            </>
          ) : item.status === 'A' && !item.verified ? (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: '#7c3aed' }]}
              activeOpacity={0.85}
              onPress={() => void handleAction(item.id, 'verify')}
            >
              <Text style={styles.actionBtnText}>
                {t('home.modTasksVerifyBtn', { defaultValue: 'Verify & Penalise' })}
              </Text>
            </TouchableOpacity>
          ) : item.verified ? (
            <Text style={styles.verifiedText}>
              ✓ {t('home.modTasksVerified', { defaultValue: 'Verified' })}
            </Text>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  }, [actionLoading, c, openDetail, handleAction, t]);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      {/* Status tabs */}
      <View style={[styles.tabsRow, { borderBottomColor: c.border, backgroundColor: c.surface }]}>
        {(['P', 'A', 'R'] as const).map((s) => {
          const label = s === 'P' ? t('home.modTasksPending', { defaultValue: 'Pending' })
            : s === 'A' ? t('home.modTasksApproved', { defaultValue: 'Approved' })
            : t('home.modTasksRejected', { defaultValue: 'Rejected' });
          const active = status === s;
          return (
            <TouchableOpacity
              key={s}
              style={[styles.tab, { borderBottomColor: active ? c.primary : 'transparent' }]}
              onPress={() => { if (s !== status) { setStatus(s); setItems([]); } }}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabText, { color: active ? c.primary : c.textMuted }]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading && items.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color={c.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => `mod-${item.id}`}
          renderItem={renderRow}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { void onRefresh(); }}
              tintColor={c.primary}
              colors={[c.primary]}
            />
          }
          ListEmptyComponent={
            <Text style={[styles.emptyText, { color: c.textMuted }]}>
              {t('home.modTasksEmpty', { defaultValue: 'No items in this queue.' })}
            </Text>
          }
        />
      )}

      {/* Detail bottom sheet */}
      <Modal
        visible={!!detailItem}
        transparent
        animationType={Platform.OS === 'web' ? 'fade' : 'slide'}
        onRequestClose={closeDetail}
      >
        <Pressable style={styles.modalOverlay} onPress={closeDetail}>
          <Pressable
            style={[styles.modalSheet, { backgroundColor: c.surface, borderColor: c.border }]}
            onPress={() => {}}
          >
            <View style={[styles.sheetHeader, { borderBottomColor: c.border }]}>
              <TouchableOpacity onPress={closeDetail} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <MaterialCommunityIcons name="arrow-left" size={20} color={c.textSecondary} />
              </TouchableOpacity>
              <Text style={[styles.sheetTitle, { color: c.textPrimary }]}>
                {t('home.modTasksDetailTitle', { defaultValue: 'Report details' })}
              </Text>
              <TouchableOpacity onPress={closeDetail} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <MaterialCommunityIcons name="close" size={20} color={c.textMuted} />
              </TouchableOpacity>
            </View>

            {detailItem ? (
              <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
                {(() => {
                  const item = detailItem;
                  const co = item.content_object;
                  const sevColor = severityColorOf(item.category?.severity);
                  const author = authorOf(item);
                  const text = contentTextOf(item);
                  const parentText = co?.post?.text;
                  const isActioning = actionLoading === item.id;

                  return (
                    <>
                      <View style={[styles.contentBox, { backgroundColor: c.inputBackground, borderColor: c.border }]}>
                        <View style={styles.rowHeader}>
                          <View style={[styles.typeBadge, { backgroundColor: sevColor }]}>
                            <Text style={styles.typeBadgeText}>{typeLabelOf(item)}</Text>
                          </View>
                          {item.category ? (
                            <Text style={[styles.categoryText, { color: c.textMuted }]} numberOfLines={1}>
                              {item.category.title || item.category.name}
                            </Text>
                          ) : null}
                        </View>
                        {author ? (
                          <Text style={[styles.detailAuthor, { color: c.textSecondary }]}>@{author}</Text>
                        ) : null}
                        {parentText ? (
                          <View style={[styles.parentQuote, { borderLeftColor: c.border }]}>
                            <Text style={[styles.parentQuoteLabel, { color: c.textMuted }]}>
                              {t('home.modTasksDetailInReplyTo', { defaultValue: 'On post:' })}
                            </Text>
                            <Text style={[styles.parentQuoteText, { color: c.textMuted }]} numberOfLines={3}>{parentText}</Text>
                          </View>
                        ) : null}
                        {text ? (
                          <Text style={[styles.detailText, { color: c.textPrimary }]}>{text}</Text>
                        ) : null}
                      </View>

                      <Text style={[styles.sectionLabel, { color: c.textMuted }]}>
                        {t('home.modTasksDetailReportsTitle', {
                          defaultValue: 'Reports ({{count}})',
                          count: item.reports_count,
                        })}
                      </Text>

                      {detailReportsLoading ? (
                        <ActivityIndicator color={c.primary} size="small" />
                      ) : detailReports.length === 0 ? (
                        <Text style={[styles.emptyText, { color: c.textMuted, marginTop: 0 }]}>
                          {t('home.modTasksDetailReportsEmpty', { defaultValue: 'No reports recorded.' })}
                        </Text>
                      ) : (
                        detailReports.map((report) => (
                          <View key={report.id} style={[styles.reportRow, { borderBottomColor: c.border }]}>
                            <View style={styles.reporterHeader}>
                              <View style={[styles.reporterAvatar, { backgroundColor: c.primary }]}>
                                {report.reporter.profile?.avatar ? (
                                  <Image source={{ uri: report.reporter.profile.avatar }} style={styles.reporterAvatarImage} resizeMode="cover" />
                                ) : (
                                  <Text style={styles.reporterAvatarText}>
                                    {(report.reporter.username?.[0] || '?').toUpperCase()}
                                  </Text>
                                )}
                              </View>
                              <Text style={[styles.reporterName, { color: c.textSecondary }]}>@{report.reporter.username}</Text>
                              <View style={{ flex: 1 }} />
                              <Text style={[styles.reporterCategory, { color: c.textMuted }]} numberOfLines={1}>
                                {report.category.title || report.category.name}
                              </Text>
                            </View>
                            {report.description ? (
                              <Text style={[styles.reportDescription, { color: c.textSecondary }]}>{report.description}</Text>
                            ) : null}
                          </View>
                        ))
                      )}

                      {!item.verified ? (
                        <View style={styles.detailActionsRow}>
                          {isActioning ? (
                            <ActivityIndicator color={c.primary} size="small" />
                          ) : item.status === 'P' ? (
                            <>
                              <TouchableOpacity
                                style={[styles.detailActionBtn, { backgroundColor: '#16a34a' }]}
                                activeOpacity={0.85}
                                onPress={() => void handleAction(item.id, 'approve')}
                              >
                                <Text style={styles.detailActionBtnText}>
                                  {t('home.modTasksApproveBtn', { defaultValue: 'Approve' })}
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.detailActionBtn, { backgroundColor: '#dc2626' }]}
                                activeOpacity={0.85}
                                onPress={() => void handleAction(item.id, 'reject')}
                              >
                                <Text style={styles.detailActionBtnText}>
                                  {t('home.modTasksRejectBtn', { defaultValue: 'Reject' })}
                                </Text>
                              </TouchableOpacity>
                            </>
                          ) : item.status === 'A' ? (
                            <TouchableOpacity
                              style={[styles.detailActionBtn, { backgroundColor: '#7c3aed' }]}
                              activeOpacity={0.85}
                              onPress={() => void handleAction(item.id, 'verify')}
                            >
                              <Text style={styles.detailActionBtnText}>
                                {t('home.modTasksVerifyBtn', { defaultValue: 'Verify & Penalise' })}
                              </Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      ) : (
                        <Text style={styles.verifiedTextCentered}>
                          ✓ {t('home.modTasksVerified', { defaultValue: 'Verified' })}
                        </Text>
                      )}
                    </>
                  );
                })()}
              </ScrollView>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  tabsRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tab: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderBottomWidth: 2,
  },
  tabText: { fontSize: 13, fontWeight: '700', letterSpacing: 0.4 },
  listContent: { padding: 14, paddingBottom: 140 },
  emptyText: { fontSize: 14, textAlign: 'center', marginTop: 32, paddingHorizontal: 24 },
  row: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  typeBadge: {
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  typeBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  categoryText: { fontSize: 12, flex: 1 },
  reportCount: { fontSize: 12 },
  author: { fontSize: 13, fontWeight: '700', marginBottom: 2 },
  preview: { fontSize: 14, lineHeight: 19 },
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' },
  actionBtn: { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  actionBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  verifiedText: { fontSize: 12, color: '#16a34a', fontWeight: '700' },

  // ── Detail sheet ──────────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    ...Platform.select({
      native: { justifyContent: 'flex-end' },
      default: { justifyContent: 'center', alignItems: 'center', padding: 20 },
    }),
  },
  modalSheet: {
    width: '100%',
    borderWidth: 1,
    ...Platform.select({
      native: {
        borderTopLeftRadius: 22,
        borderTopRightRadius: 22,
        height: '92%',
        borderBottomWidth: 0,
      },
      default: {
        maxWidth: 540,
        borderRadius: 14,
        maxHeight: '90%',
      },
    }),
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  sheetTitle: { fontSize: 16, fontWeight: '800', flex: 1 },
  contentBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  detailAuthor: { fontSize: 13, fontWeight: '700' },
  parentQuote: { borderLeftWidth: 2, paddingLeft: 10, gap: 2 },
  parentQuoteLabel: { fontSize: 11 },
  parentQuoteText: { fontSize: 12 },
  detailText: { fontSize: 14, lineHeight: 20 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  reportRow: { borderBottomWidth: 1, paddingBottom: 12, gap: 4 },
  reporterHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reporterAvatar: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  reporterAvatarImage: { width: 28, height: 28 },
  reporterAvatarText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  reporterName: { fontSize: 13, fontWeight: '700' },
  reporterCategory: { fontSize: 11, maxWidth: 140 },
  reportDescription: { fontSize: 13, lineHeight: 18, marginLeft: 36 },
  detailActionsRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  detailActionBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  detailActionBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  verifiedTextCentered: { fontSize: 14, color: '#16a34a', fontWeight: '700', textAlign: 'center' },
});
