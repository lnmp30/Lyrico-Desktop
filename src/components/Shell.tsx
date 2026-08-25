import {
  AppstoreOutlined,
  CloudSyncOutlined,
  CustomerServiceOutlined,
  FolderOutlined,
  DeleteOutlined,
  UnorderedListOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SettingOutlined,
  TagsOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Badge, Button, Drawer, Flex, Layout, Menu, Progress, Table, Tooltip, Typography, type MenuProps, type TableColumnsType } from "antd";
import { memo, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AudioTrack, LibraryFolder, ReplayGainProgress, ScanProgress, ViewKey } from "../app/types";
import { useReplayGainProgress } from "../hooks/useReplayGainProgress";

const { Sider, Content } = Layout;
const { Text } = Typography;

export const Shell = memo(function Shell({
  activeView,
  children,
  folders,
  trackCount,
  scanProgress,
  selectedTracks,
  onChangeView,
  onCancelReplayGain,
  onRemoveSelectedTrack,
  onClearSelectedTracks,
  onOpenSelectedBatch,
}: {
  activeView: ViewKey;
  children: ReactNode;
  folders: LibraryFolder[];
  trackCount: number;
  scanProgress?: ScanProgress;
  selectedTracks: AudioTrack[];
  onChangeView: (view: ViewKey) => void;
  onCancelReplayGain: () => void;
  onRemoveSelectedTrack: (path: string) => void;
  onClearSelectedTracks: () => void;
  onOpenSelectedBatch: () => void;
}) {
  const { t } = useTranslation();
  const replayGainProgress = useReplayGainProgress();
  const [collapsed, setCollapsed] = useState(false);
  const [selectionDrawerOpen, setSelectionDrawerOpen] = useState(false);
  const navigationItems: MenuProps["items"] = useMemo(() => [
    {
      type: "group",
      label: t("nav.library"),
      children: [
        { key: "songs", icon: <CustomerServiceOutlined />, label: t("common.songs") },
        { key: "albums", icon: <AppstoreOutlined />, label: t("common.albums") },
        { key: "artists", icon: <TeamOutlined />, label: t("common.artists") },
        { key: "folders", icon: <FolderOutlined />, label: t("common.folders") },
      ],
    },
    {
      type: "group",
      label: t("nav.tools"),
      children: [
        { key: "sources", icon: <TagsOutlined />, label: t("common.sources") },
        { key: "tasks", icon: <CloudSyncOutlined />, label: t("common.tasks") },
      ],
    },
  ], [t]);

  return (
    <Layout className="app-shell">
      <Sider
        className="side-panel"
        width={244}
        collapsedWidth={76}
        collapsed={collapsed}
        breakpoint="lg"
        trigger={null}
        onBreakpoint={setCollapsed}
      >

        <nav className="side-navigation" aria-label={t("nav.primary")}>
          <Menu
            mode="inline"
            inlineCollapsed={collapsed}
            selectedKeys={activeView === "settings" ? [] : [activeView]}
            items={navigationItems}
            onSelect={({ key }) => onChangeView(key as ViewKey)}
          />
        </nav>

        <div className="side-footer">
          {!collapsed && (
            <div className="side-library-summary">
              <Text type="secondary">{t("nav.librarySummary", { tracks: trackCount, folders: folders.length })}</Text>
            </div>
          )}
          <Tooltip title={collapsed ? t("common.settings") : undefined} placement="right">
            <Button
              type="text"
              aria-label={t("common.settings")}
              className={`side-action-button side-settings-button${activeView === "settings" ? " is-active" : ""}`}
              icon={<SettingOutlined />}
              onClick={() => onChangeView("settings")}
            >
              {!collapsed && <span className="side-action-text">{t("common.settings")}</span>}
            </Button>
          </Tooltip>
          <Tooltip title={collapsed ? t("selection.showSelected") : undefined} placement="right">
            <Button
              type="text"
              aria-label={t("selection.showSelected")}
              className="side-action-button side-selection-button"
              icon={
                <Badge count={selectedTracks.length} size="small" overflowCount={99} color="#1677ff" offset={[5, -3]}>
                  <UnorderedListOutlined />
                </Badge>
              }
              onClick={() => setSelectionDrawerOpen(true)}
            >
              {!collapsed && (
                <span className="side-action-label">
                  <span className="side-action-text">{t("selection.selectedSongs")}</span>
                  <Badge count={selectedTracks.length} showZero overflowCount={99} color="#1677ff" />
                </span>
              )}
            </Button>
          </Tooltip>
          <Tooltip title={collapsed ? t("nav.expand") : t("nav.collapse")} placement="right">
            <Button
              type="text"
              aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
              className="side-action-button side-collapse-button"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((value) => !value)}
            >
              {!collapsed && <span className="side-action-text">{t("nav.collapse")}</span>}
            </Button>
          </Tooltip>
        </div>
      </Sider>

      <Layout className="app-main">
        {scanProgress && <GlobalScanProgress progress={scanProgress} />}
        {replayGainProgress?.status === "running" && <GlobalReplayGainProgress progress={replayGainProgress} onCancel={onCancelReplayGain} />}
        <Content className="app-content">{children}</Content>
      </Layout>
      <SelectionDrawer
        open={selectionDrawerOpen}
        tracks={selectedTracks}
        onClose={() => setSelectionDrawerOpen(false)}
        onRemove={onRemoveSelectedTrack}
        onClear={onClearSelectedTracks}
        onOpenBatch={() => {
          setSelectionDrawerOpen(false);
          onOpenSelectedBatch();
        }}
      />
    </Layout>
  );
});

function SelectionDrawer({ open, tracks, onClose, onRemove, onClear, onOpenBatch }: { open: boolean; tracks: AudioTrack[]; onClose: () => void; onRemove: (path: string) => void; onClear: () => void; onOpenBatch: () => void }) {
  const { t } = useTranslation();
  const columns: TableColumnsType<AudioTrack> = [
    {
      title: t("details.titleField"),
      dataIndex: "title",
      ellipsis: true,
      render: (value: string, track) => value || track.fileName,
    },
    {
      title: t("details.artist"),
      dataIndex: "artist",
      width: 140,
      ellipsis: true,
      render: (value: string) => value || t("common.unknownArtist"),
    },
    {
      key: "remove",
      width: 52,
      align: "center",
      render: (_, track) => (
        <Tooltip title={t("common.remove")}>
          <Button type="text" danger aria-label={t("common.remove")} icon={<DeleteOutlined />} onClick={() => onRemove(track.path)} />
        </Tooltip>
      ),
    },
  ];
  return (
    <Drawer
      title={t("selection.drawerTitle", { count: tracks.length })}
      width={480}
      open={open}
      onClose={onClose}
      footer={
        <Flex justify="space-between" gap={12}>
          <Button disabled={tracks.length === 0} onClick={onClear}>{t("selection.clear")}</Button>
          <Button type="primary" disabled={tracks.length === 0} onClick={onOpenBatch}>{t("selection.batch")}</Button>
        </Flex>
      }
    >
      <Table rowKey="path" size="small" pagination={false} columns={columns} dataSource={tracks} locale={{ emptyText: t("selection.empty") }} />
    </Drawer>
  );
}

function GlobalReplayGainProgress({ progress, onCancel }: { progress: ReplayGainProgress; onCancel: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="global-scan-progress">
      <Flex justify="space-between" align="center" gap={12}>
        <Text strong>{t("replayGain.analyzing")}</Text>
        <Text type="secondary" ellipsis={{ tooltip: progress.path }}>{progress.path}</Text>
        <Text type="secondary">{progress.percent}%</Text>
        <Button size="small" danger onClick={onCancel}>{t("common.cancel")}</Button>
      </Flex>
      <Progress percent={progress.percent} showInfo={false} size="small" status="active" />
    </div>
  );
}

function GlobalScanProgress({ progress }: { progress: ScanProgress }) {
  const { t } = useTranslation();
  const percent = progress.total
    ? Math.round((progress.current / progress.total) * 100)
    : progress.status === "completed"
      ? 100
      : 0;
  return (
    <div className="global-scan-progress">
      <Flex justify="space-between" align="center" gap={12}>
        <Text strong>{t(`scanProgress.phase.${progress.phase}`)}</Text>
        <Text type="secondary" ellipsis={{ tooltip: progress.folderPath }}>
          {progress.folderPath}
        </Text>
        {progress.total > 0 && <Text type="secondary">{progress.current}/{progress.total}</Text>}
      </Flex>
      <Progress
        percent={percent}
        showInfo={false}
        size="small"
        status={progress.status === "failed" ? "exception" : progress.status === "completed" ? "success" : "active"}
      />
    </div>
  );
}
