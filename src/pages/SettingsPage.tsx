import { ApiOutlined, CalculatorOutlined, GlobalOutlined, ScissorOutlined, SoundOutlined } from "@ant-design/icons";
import { Button, Card, InputNumber, Modal, Radio, Select, Space, Switch, Tabs, Typography } from "antd";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ArtistSplitConfig, DesktopSettings } from "../app/types";
import type { LanguagePreference } from "../i18n";
import { ArtistSplitSettings } from "../components/ArtistSplitSettings";

const { Title, Text } = Typography;

export function SettingsPage({
  languagePreference,
  artistSplitConfig,
  settings,
  onChangeLanguage,
  onChangeArtistSplitConfig,
  onChangeSettings,
}: {
  languagePreference: LanguagePreference;
  artistSplitConfig: ArtistSplitConfig;
  settings: DesktopSettings;
  onChangeLanguage: (language: LanguagePreference) => void;
  onChangeArtistSplitConfig: (config: ArtistSplitConfig) => void;
  onChangeSettings: (settings: DesktopSettings) => void;
}) {
  const { t } = useTranslation();
  const [replayGainDialogOpen, setReplayGainDialogOpen] = useState(false);
  const [replayGainPreset, setReplayGainPreset] = useState<string>(String(settings.replayGainTargetLoudness));
  const [customLoudness, setCustomLoudness] = useState<number | null>(settings.replayGainTargetLoudness);
  const update = <K extends keyof DesktopSettings>(key: K, value: DesktopSettings[K]) => onChangeSettings({ ...settings, [key]: value });

  function openReplayGainDialog() {
    const preset = [-23, -18, -14].includes(settings.replayGainTargetLoudness)
      ? String(settings.replayGainTargetLoudness)
      : "custom";
    setReplayGainPreset(preset);
    setCustomLoudness(settings.replayGainTargetLoudness);
    setReplayGainDialogOpen(true);
  }

  function saveReplayGainTarget() {
    const value = replayGainPreset === "custom" ? customLoudness : Number(replayGainPreset);
    if (value == null || !Number.isFinite(value) || value < -60 || value > 0) return;
    update("replayGainTargetLoudness", value);
    setReplayGainDialogOpen(false);
  }

  return (
    <div className="workspace page-stack settings-view">
      <Title level={2}>{t("settings.title")}</Title>

      <Card className="content-card settings-card" styles={{ body: { padding: 0 } }}>
        <Tabs
          className="settings-tabs"
          tabPosition="left"
          items={[
            {
              key: "interface",
              label: t("settings.interface"),
              icon: <GlobalOutlined />,
              children: (
                <SettingsSection title={t("settings.interface")}>
                  <SettingRow title={t("settings.language")} description={t("settings.languageHint")}>
                    <Select<LanguagePreference>
                      value={languagePreference}
                      onChange={onChangeLanguage}
                      options={[
                        { value: "system", label: t("settings.systemLanguage") },
                        { value: "en-US", label: t("settings.english") },
                        { value: "zh-CN", label: t("settings.chinese") },
                      ]}
                    />
                  </SettingRow>
                  <SettingRow title={t("settings.themeMode")}>
                    <Select<DesktopSettings["theme"]>
                      value={settings.theme}
                      onChange={(value) => update("theme", value)}
                      options={[
                        { value: "light", label: t("settings.themeLight") },
                        { value: "dark", label: t("settings.themeDark") },
                        { value: "system", label: t("settings.themeSystem") },
                      ]}
                    />
                  </SettingRow>
                </SettingsSection>
              ),
            },
            {
              key: "online",
              label: t("settings.onlineSearch"),
              icon: <ApiOutlined />,
              children: (
                <SettingsSection title={t("settings.onlineSearch")}>
                  <SettingRow title={t("settings.searchPageSize")} description={t("settings.searchPageSizeHint")}>
                    <InputNumber min={5} max={50} precision={0} value={settings.searchPageSize} onChange={(value) => update("searchPageSize", value ?? 10)} />
                  </SettingRow>
                </SettingsSection>
              ),
            },
            {
              key: "lyrics",
              label: t("settings.lyricsSettings"),
              icon: <SoundOutlined />,
              children: (
                <SettingsSection title={t("settings.lyricsSettings")}>
                  <SettingRow title={t("settings.defaultLyricFormat")} description={t("settings.defaultLyricFormatHint")}>
                    <Select value={settings.lyricFormat} onChange={(value) => update("lyricFormat", value)} options={[
                      { value: "plainLrc", label: t("lyrics.formats.plainLrc") },
                      { value: "verbatimLrc", label: t("lyrics.formats.verbatimLrc") },
                      { value: "enhancedLrc", label: t("lyrics.formats.enhancedLrc") },
                      { value: "ttml", label: t("lyrics.formats.ttml") },
                    ]} />
                  </SettingRow>
                  <SettingRow title={t("settings.lyricsConversionMode")} description={t("settings.lyricsConversionModeHint")}>
                    <Select value={settings.lyricsConversionMode} onChange={(value) => update("lyricsConversionMode", value)} options={[
                      { value: "none", label: t("settings.conversionNone") },
                      { value: "traditionalToSimplified", label: t("settings.conversionTraditionalToSimplified") },
                      { value: "simplifiedToTraditional", label: t("settings.conversionSimplifiedToTraditional") },
                    ]} />
                  </SettingRow>
                  <SettingRow title={t("settings.includeTranslation")} description={t("settings.includeTranslationHint")}><Switch checked={settings.showTranslation} onChange={(value) => onChangeSettings({ ...settings, showTranslation: value, onlyTranslationIfAvailable: value ? settings.onlyTranslationIfAvailable : false })} /></SettingRow>
                  <SettingRow title={t("settings.onlyTranslation")} description={t("settings.onlyTranslationHint")}><Switch disabled={!settings.showTranslation} checked={settings.onlyTranslationIfAvailable} onChange={(value) => update("onlyTranslationIfAvailable", value)} /></SettingRow>
                  <SettingRow title={t("settings.includeRomanization")} description={t("settings.includeRomanizationHint")}><Switch checked={settings.showRomanization} onChange={(value) => update("showRomanization", value)} /></SettingRow>
                  <SettingRow title={t("settings.removeEmptyLyricLines")} description={t("settings.removeEmptyLyricLinesHint")}><Switch checked={settings.removeEmptyLyricLines} onChange={(value) => update("removeEmptyLyricLines", value)} /></SettingRow>
                </SettingsSection>
              ),
            },
            {
              key: "replayGain",
              label: t("settings.replayGain"),
              icon: <CalculatorOutlined />,
              children: (
                <SettingsSection title={t("settings.replayGain")}>
                  <SettingRow title={t("settings.replayGainTargetLoudness")} description={t("settings.replayGainTargetLoudnessHint")}>
                    <Button onClick={openReplayGainDialog}>{formatLoudness(settings.replayGainTargetLoudness)}</Button>
                  </SettingRow>
                </SettingsSection>
              ),
            },
            {
              key: "library",
              label: t("settings.library"),
              icon: <ScissorOutlined />,
              children: (
                <SettingsSection title={t("artistSplit.title")}>
                  <ArtistSplitSettings config={artistSplitConfig} onChange={onChangeArtistSplitConfig} />
                </SettingsSection>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={t("settings.replayGainTargetLoudness")}
        open={replayGainDialogOpen}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        okButtonProps={{ disabled: replayGainPreset === "custom" && (customLoudness == null || customLoudness < -60 || customLoudness > 0) }}
        onOk={saveReplayGainTarget}
        onCancel={() => setReplayGainDialogOpen(false)}
        destroyOnHidden
      >
        <Space orientation="vertical" size={12} className="full-width">
          <Radio.Group value={replayGainPreset} onChange={(event) => setReplayGainPreset(event.target.value)} className="full-width">
            <Space orientation="vertical" className="full-width">
              <Radio value="-23">{t("settings.replayGainPresetEbu")}</Radio>
              <Radio value="-18">{t("settings.replayGainPresetDefault")}</Radio>
              <Radio value="-14">{t("settings.replayGainPresetStreaming")}</Radio>
              <Radio value="custom">{t("settings.replayGainPresetCustom")}</Radio>
            </Space>
          </Radio.Group>
          {replayGainPreset === "custom" ? <InputNumber
            min={-60}
            max={0}
            precision={2}
            value={customLoudness}
            addonAfter="LUFS"
            placeholder={t("settings.replayGainCustomPlaceholder")}
            className="full-width"
            onChange={setCustomLoudness}
          /> : null}
          {replayGainPreset === "custom" && (customLoudness == null || customLoudness < -60 || customLoudness > 0)
            ? <Typography.Text type="danger">{t("settings.replayGainTargetInvalid")}</Typography.Text>
            : null}
        </Space>
      </Modal>
    </div>
  );
}

function formatLoudness(value: number) {
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2)} LUFS`;
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="settings-section"><Typography.Title level={4}>{title}</Typography.Title>{children}</section>;
}

function SettingRow({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-row-copy"><Text strong>{title}</Text>{description ? <Text type="secondary">{description}</Text> : null}</div>
      <div className="setting-row-control">{children}</div>
    </div>
  );
}
