import { ApiOutlined, DatabaseOutlined, FolderOpenOutlined, GlobalOutlined, InfoCircleOutlined, ScissorOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Descriptions, Form, Select, Space, Tabs, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { useEffect, useState, type ReactNode } from "react";
import type { ArtistSplitConfig, SourcePlugin, StorageInfo, ViewKey } from "../app/types";
import type { LanguagePreference } from "../i18n";
import { ArtistSplitSettings } from "../components/ArtistSplitSettings";
import { getStorageInfo } from "../backend/audioApi";

const { Title, Text } = Typography;

export function SettingsPage({
  languagePreference,
  folderCount,
  trackCount,
  plugins,
  artistSplitConfig,
  onChangeLanguage,
  onChangeArtistSplitConfig,
  onNavigate,
}: {
  languagePreference: LanguagePreference;
  folderCount: number;
  trackCount: number;
  plugins: SourcePlugin[];
  artistSplitConfig: ArtistSplitConfig;
  onChangeLanguage: (language: LanguagePreference) => void;
  onChangeArtistSplitConfig: (config: ArtistSplitConfig) => void;
  onNavigate: (view: ViewKey) => void;
}) {
  const { t } = useTranslation();
  const enabledPlugins = plugins.filter((plugin) => plugin.enabled);
  const [storageInfo, setStorageInfo] = useState<StorageInfo>();

  useEffect(() => {
    void getStorageInfo().then(setStorageInfo).catch(() => setStorageInfo(undefined));
  }, []);

  return (
    <div className="workspace page-stack settings-view">
      <div>
        <Title level={2}>{t("settings.title")}</Title>
        <Text type="secondary">{t("settings.description")}</Text>
      </div>

      <Card className="settings-card" styles={{ body: { padding: 0 } }}>
        <Tabs
          className="settings-tabs"
          tabPlacement="start"
          items={[
            {
              key: "general",
              label: <Space><GlobalOutlined />{t("settings.general")}</Space>,
              children: (
                <SettingsSection title={t("settings.interface")}>
                  <Form layout="vertical" className="settings-form">
                    <Form.Item label={t("settings.language")} extra={t("settings.languageHint")}>
                      <Select<LanguagePreference>
                        value={languagePreference}
                        onChange={onChangeLanguage}
                        options={[
                          { value: "system", label: t("settings.systemLanguage") },
                          { value: "en-US", label: t("settings.english") },
                          { value: "zh-CN", label: t("settings.chinese") },
                        ]}
                      />
                    </Form.Item>
                  </Form>
                </SettingsSection>
              ),
            },
            {
              key: "metadata",
              label: <Space><ScissorOutlined />{t("settings.metadata")}</Space>,
              children: (
                <SettingsSection title={t("artistSplit.title")}>
                  <ArtistSplitSettings config={artistSplitConfig} onChange={onChangeArtistSplitConfig} />
                </SettingsSection>
              ),
            },
            {
              key: "library",
              label: <Space><DatabaseOutlined />{t("settings.library")}</Space>,
              children: (
                <SettingsSection title={t("settings.librarySummary")}>
                  <Alert
                    showIcon
                    type="info"
                    title={t("settings.startupTitle")}
                    description={t("settings.startupDescription")}
                  />
                  <Descriptions
                    bordered
                    column={1}
                    items={[
                      { key: "songs", label: t("common.songs"), children: t("common.songCount", { count: trackCount }) },
                      { key: "folders", label: t("common.folders"), children: t("common.folderCount", { count: folderCount }) },
                      {
                        key: "persistence",
                        label: t("settings.persistence"),
                        children: storageInfo ? (
                          <Space orientation="vertical" size={4}>
                            <Tag color={storageInfo.location === "installation" ? "blue" : "gold"}>
                              {t(`settings.storageLocation.${storageInfo.location}`)}
                            </Tag>
                            <Text copyable={{ text: storageInfo.databasePath }}>{storageInfo.databasePath}</Text>
                          </Space>
                        ) : t("settings.persistenceValue"),
                      },
                      { key: "artwork", label: t("settings.artwork"), children: t("settings.artworkValue") },
                    ]}
                  />
                  <Button icon={<FolderOpenOutlined />} onClick={() => onNavigate("folders")}>{t("settings.manageFolders")}</Button>
                </SettingsSection>
              ),
            },
            {
              key: "sources",
              label: <Space><ApiOutlined />{t("settings.integrations")}</Space>,
              children: (
                <SettingsSection title={t("settings.sourceSummary")}>
                  <Space wrap>
                    {enabledPlugins.length
                      ? enabledPlugins.map((plugin) => <Tag color="success" key={plugin.id}>{plugin.name}</Tag>)
                      : <Text type="secondary">{t("settings.noSources")}</Text>}
                  </Space>
                  <Button icon={<ApiOutlined />} onClick={() => onNavigate("sources")}>{t("settings.manageSources")}</Button>
                </SettingsSection>
              ),
            },
            {
              key: "about",
              label: <Space><InfoCircleOutlined />{t("settings.about")}</Space>,
              children: (
                <SettingsSection title={t("settings.about")}>
                  <Descriptions
                    bordered
                    column={1}
                    items={[
                      { key: "product", label: t("settings.product"), children: "Lyrico Desktop" },
                      { key: "version", label: t("settings.version"), children: "0.1.0" },
                      { key: "framework", label: t("settings.framework"), children: "Tauri 2 · React 19 · Ant Design 6" },
                    ]}
                  />
                </SettingsSection>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <Title level={4}>{title}</Title>
      <Space orientation="vertical" size={20} className="full-width">{children}</Space>
    </section>
  );
}
