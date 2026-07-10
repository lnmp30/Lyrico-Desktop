import {
  AppstoreOutlined,
  CloudSyncOutlined,
  CustomerServiceOutlined,
  FolderOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SettingOutlined,
  TagsOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Button, Flex, Layout, Menu, Progress, Space, Tooltip, Typography, type MenuProps } from "antd";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { LibraryFolder, ScanProgress, ViewKey } from "../app/types";

const { Sider, Content } = Layout;
const { Text } = Typography;

export function Shell({
  activeView,
  children,
  folders,
  trackCount,
  scanProgress,
  onChangeView,
}: {
  activeView: ViewKey;
  children: ReactNode;
  folders: LibraryFolder[];
  trackCount: number;
  scanProgress?: ScanProgress;
  onChangeView: (view: ViewKey) => void;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const navigationItems: MenuProps["items"] = [
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
    {
      type: "group",
      label: t("nav.system"),
      children: [{ key: "settings", icon: <SettingOutlined />, label: t("common.settings") }],
    },
  ];

  return (
    <Layout className="app-shell">
      <Sider
        className="side-panel"
        width={220}
        collapsedWidth={72}
        collapsed={collapsed}
        breakpoint="lg"
        trigger={null}
        onBreakpoint={setCollapsed}
      >
        <div className="brand">
          <div className="brand-icon">♪</div>
          {!collapsed && <Text strong>Lyrico</Text>}
        </div>

        <Menu
          mode="inline"
          inlineCollapsed={collapsed}
          selectedKeys={[activeView]}
          items={navigationItems}
          onSelect={({ key }) => onChangeView(key as ViewKey)}
        />

        <div className="side-footer">
          {!collapsed && (
            <Space orientation="vertical" size={0} className="library-summary">
              <Text strong>{t("common.songCount", { count: trackCount })}</Text>
              <Text type="secondary">{t("common.folderCount", { count: folders.length })}</Text>
            </Space>
          )}
          <Tooltip title={collapsed ? t("nav.expand") : t("nav.collapse")} placement="right">
            <Button
              type="text"
              aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((value) => !value)}
            />
          </Tooltip>
        </div>
      </Sider>

      <Layout className="app-main">
        {scanProgress && <GlobalScanProgress progress={scanProgress} />}
        <Content className="app-content">{children}</Content>
      </Layout>
    </Layout>
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
