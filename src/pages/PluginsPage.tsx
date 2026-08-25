import { ApiOutlined, AppstoreAddOutlined, ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, SettingOutlined } from "@ant-design/icons";
import { Alert, Avatar, Button, Card, Checkbox, Empty, Flex, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Tag, Tabs, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import type { PluginConfigField, PluginInstallDraft, PluginSourceKind, SourcePlugin } from "../app/types";
import { capabilityLabel } from "../data/pluginCatalog";
import { isPluginSourceEnabled, normalizedCapabilities, pluginSourceOrder, supportedSourceKinds } from "../domain/pluginSources";

const { Title, Text, Paragraph } = Typography;
const SOURCE_KINDS: PluginSourceKind[] = ["aggregated", "metadata", "lyrics", "covers"];

type PluginsPageProps = {
  plugins: SourcePlugin[];
  onPrepareInstall: () => Promise<PluginInstallDraft | undefined>;
  onInstall: (archivePath: string, selectedRoots: string[], allowDowngrade: boolean) => Promise<void>;
  onChangeSourceEnabled: (pluginId: string, sourceKind: PluginSourceKind, enabled: boolean) => Promise<void>;
  onChangeSourceOrder: (sourceKind: PluginSourceKind, pluginIds: string[]) => Promise<void>;
  onSaveConfig: (pluginId: string, config: Record<string, string>) => Promise<void>;
  onUninstall: (pluginId: string) => Promise<void>;
};

export function PluginsPage({ plugins, onPrepareInstall, onInstall, onChangeSourceEnabled, onChangeSourceOrder, onSaveConfig, onUninstall }: PluginsPageProps) {
  const { t } = useTranslation();
  const [sourceKind, setSourceKind] = useState<PluginSourceKind>("aggregated");
  const [editingPluginId, setEditingPluginId] = useState<string>();
  const [config, setConfig] = useState<Record<string, string>>({});
  const [busyAction, setBusyAction] = useState<string>();
  const [installDraft, setInstallDraft] = useState<PluginInstallDraft>();
  const [selectedInstallRoots, setSelectedInstallRoots] = useState<string[]>([]);
  const editingPlugin = plugins.find((plugin) => plugin.id === editingPluginId);
  const visiblePlugins = useMemo(() => plugins
    .filter((plugin) => supportedSourceKinds(plugin).includes(sourceKind))
    .sort((left, right) => pluginSourceOrder(left, sourceKind) - pluginSourceOrder(right, sourceKind) || left.name.localeCompare(right.name)), [plugins, sourceKind]);

  useEffect(() => setConfig(editingPlugin?.config ?? {}), [editingPlugin]);

  async function runAction(key: string, action: () => Promise<void>) {
    setBusyAction(key);
    try { await action(); } finally { setBusyAction(undefined); }
  }

  async function choosePluginArchive() {
    setBusyAction("prepare-install");
    try {
      const draft = await onPrepareInstall();
      if (!draft) return;
      setInstallDraft(draft);
      setSelectedInstallRoots(draft.preview.candidates
        .filter((candidate) => candidate.conflict !== "downgrade")
        .map((candidate) => candidate.relativeRoot));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function confirmInstall() {
    if (!installDraft || selectedInstallRoots.length === 0) return;
    const allowDowngrade = installDraft.preview.candidates.some((candidate) =>
      selectedInstallRoots.includes(candidate.relativeRoot) && candidate.conflict === "downgrade");
    await runAction("install", async () => {
      await onInstall(installDraft.archivePath, selectedInstallRoots, allowDowngrade);
      setInstallDraft(undefined);
      setSelectedInstallRoots([]);
    });
  }

  async function movePlugin(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= visiblePlugins.length) return;
    const reordered = [...visiblePlugins];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved);
    await runAction(`order:${moved.id}`, () => onChangeSourceOrder(sourceKind, reordered.map((plugin) => plugin.id)));
  }

  const manifest = editingPlugin ? JSON.stringify(stripRuntimeFields(editingPlugin), null, 2) : "";

  return (
    <div className="workspace page-stack plugin-manager-page">
      <Flex justify="space-between" align="start" gap={16} wrap>
        <Title level={2}>{t("sources.title")}</Title>
        <Button type="primary" icon={<AppstoreAddOutlined />} loading={busyAction === "prepare-install"} onClick={() => void choosePluginArchive()}>{t("sources.install")}</Button>
      </Flex>

      <Card className="plugin-source-type-card" styles={{ body: { paddingBottom: 12 } }}>
        <Tabs activeKey={sourceKind} onChange={(key) => setSourceKind(key as PluginSourceKind)} items={SOURCE_KINDS.map((kind) => ({ key: kind, label: t(`sources.types.${kind}`) }))} />
        <Text type="secondary">{t("sources.priorityHint")}</Text>
      </Card>

      {visiblePlugins.length ? <Space orientation="vertical" size={12} className="full-width">
        {visiblePlugins.map((plugin, index) => {
          const enabled = isPluginSourceEnabled(plugin, sourceKind);
          const orderBusy = busyAction?.startsWith("order:");
          return <Card key={plugin.id} className="plugin-source-card">
            <Flex align="center" gap={14} wrap>
              <PluginIcon plugin={plugin} />
              <Flex vertical gap={3} className="plugin-source-card-copy">
                <Space size={8} wrap><Text strong>{plugin.name}</Text><Tag>v{plugin.versionName}</Tag><Tag>API {plugin.apiVersion}</Tag></Space>
                <Text type="secondary">{plugin.author || t("sources.unknownAuthor")}</Text>
              </Flex>
              <Space className="plugin-priority-controls">
                <Text type="secondary">{t("sources.priority", { value: index + 1 })}</Text>
                <Button aria-label={t("sources.moveUp")} icon={<ArrowUpOutlined />} disabled={index === 0 || orderBusy} onClick={() => void movePlugin(index, -1)} />
                <Button aria-label={t("sources.moveDown")} icon={<ArrowDownOutlined />} disabled={index === visiblePlugins.length - 1 || orderBusy} onClick={() => void movePlugin(index, 1)} />
              </Space>
              <Switch checked={enabled} loading={busyAction === `enabled:${plugin.id}`} checkedChildren={t("common.enabled")} unCheckedChildren={t("common.disabled")} onChange={(next) => void runAction(`enabled:${plugin.id}`, () => onChangeSourceEnabled(plugin.id, sourceKind, next))} />
            </Flex>
            {plugin.description ? <Paragraph type="secondary" ellipsis={{ rows: 2 }} className="plugin-card-description">{plugin.description}</Paragraph> : null}
            <Flex justify="space-between" align="center" gap={12} wrap className="plugin-card-footer">
              <Space size={[4, 6]} wrap>{normalizedCapabilities(plugin).map((capability) => <Tag key={capability}>{capabilityLabel(capability)}</Tag>)}</Space>
              <Space>
                <Button icon={<SettingOutlined />} onClick={() => setEditingPluginId(plugin.id)}>{t("sources.configuration")}</Button>
                <Popconfirm title={t("sources.uninstallConfirm", { name: plugin.name })} okButtonProps={{ danger: true }} onConfirm={() => runAction(`uninstall:${plugin.id}`, () => onUninstall(plugin.id))}>
                  <Button danger icon={<DeleteOutlined />} loading={busyAction === `uninstall:${plugin.id}`}>{t("sources.uninstall")}</Button>
                </Popconfirm>
              </Space>
            </Flex>
          </Card>;
        })}
      </Space> : <Card><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={plugins.length ? t("sources.noneForType") : t("sources.none")} /></Card>}

      <Modal
        title={t("sources.installTitle")}
        open={Boolean(installDraft)}
        okText={t("sources.installConfirm")}
        cancelText={t("common.cancel")}
        okButtonProps={{ disabled: selectedInstallRoots.length === 0, loading: busyAction === "install" }}
        cancelButtonProps={{ disabled: busyAction === "install" }}
        closable={busyAction !== "install"}
        maskClosable={busyAction !== "install"}
        onOk={() => void confirmInstall()}
        onCancel={() => { setInstallDraft(undefined); setSelectedInstallRoots([]); }}
        width={680}
        destroyOnHidden
      >
        {installDraft ? <Space orientation="vertical" size={12} className="full-width">
          {installDraft.preview.candidates.map((candidate) => {
            const selected = selectedInstallRoots.includes(candidate.relativeRoot);
            const version = candidate.existingVersionName
              ? `${candidate.existingVersionName} → ${candidate.manifest.versionName}`
              : candidate.manifest.versionName;
            return <Card key={candidate.relativeRoot} size="small" className={`plugin-install-candidate${selected ? " is-selected" : ""}`} onClick={() => setSelectedInstallRoots((current) => selected ? current.filter((root) => root !== candidate.relativeRoot) : [...current, candidate.relativeRoot])}>
              <Flex align="center" gap={12}>
                <Avatar shape="square" size={42} src={candidate.iconDataUrl} icon={<ApiOutlined />} />
                <Flex vertical gap={3} className="plugin-source-card-copy">
                  <Space size={8} wrap>
                    <Text strong>{candidate.manifest.name}</Text>
                    <Tag color={conflictColor(candidate.conflict)}>{t(`sources.conflicts.${candidate.conflict}`)}</Tag>
                  </Space>
                  <Text type="secondary">{version}{candidate.manifest.author ? ` · ${candidate.manifest.author}` : ""}</Text>
                  <Space size={[4, 4]} wrap>{candidate.manifest.capabilities.map((capability) => <Tag key={capability}>{capabilityLabel(capability)}</Tag>)}</Space>
                  {candidate.manifest.description ? <Text type="secondary">{candidate.manifest.description}</Text> : null}
                </Flex>
                <Checkbox checked={selected} onClick={(event) => event.stopPropagation()} onChange={(event) => setSelectedInstallRoots((current) => event.target.checked ? [...new Set([...current, candidate.relativeRoot])] : current.filter((root) => root !== candidate.relativeRoot))} />
              </Flex>
            </Card>;
          })}
          {installDraft.preview.failed.map((failure) => <Alert key={`${failure.rootPath}:${failure.reason}`} type="error" showIcon message={failure.pluginId || failure.rootPath || t("sources.invalidPlugin")} description={failure.reason} />)}
        </Space> : null}
      </Modal>

      <Modal title={editingPlugin?.name} open={Boolean(editingPlugin)} width={720} footer={null} onCancel={() => setEditingPluginId(undefined)} destroyOnHidden>
        {editingPlugin ? <Tabs items={[
          { key: "configuration", label: t("sources.configuration"), children: editingPlugin.configFields.length ? <Form layout="vertical" className="source-config-form">
            {editingPlugin.configFields.filter((field) => dependencyMatches(field.dependency, config)).map((field) => <ConfigField key={field.key} field={field} value={config[field.key] ?? field.defaultValue ?? ""} onChange={(value) => setConfig((current) => ({ ...current, [field.key]: value }))} />)}
            <Button type="primary" loading={busyAction === "save"} onClick={() => void runAction("save", async () => { await onSaveConfig(editingPlugin.id, config); setEditingPluginId(undefined); })}>{t("common.save")}</Button>
          </Form> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("sources.noConfiguration")} /> },
          { key: "manifest", label: t("sources.manifest"), children: <pre className="code-preview">{manifest}</pre> },
        ]} /> : null}
      </Modal>
    </div>
  );
}

function stripRuntimeFields(plugin: SourcePlugin) {
  const { sourceStates: _sourceStates, installedAt: _installedAt, updatedAt: _updatedAt, pluginDir: _pluginDir, iconPath: _iconPath, iconDataUrl: _iconDataUrl, config: _config, ...manifest } = plugin;
  return manifest;
}

function PluginIcon({ plugin }: { plugin: SourcePlugin }) { return <Avatar shape="square" size={48} src={plugin.iconDataUrl} icon={<ApiOutlined />} />; }

function conflictColor(conflict: "new" | "update" | "overwrite" | "downgrade") {
  if (conflict === "downgrade") return "error";
  if (conflict === "overwrite") return "warning";
  return "processing";
}

function ConfigField({ field, value, onChange }: { field: PluginConfigField; value: string; onChange: (value: string) => void }) {
  if (field.type === "markdown") return <section className="plugin-markdown-field">{field.title ? <Text strong>{field.title}</Text> : null}<div className="plugin-markdown-content"><ReactMarkdown skipHtml>{field.defaultValue || field.summary || ""}</ReactMarkdown></div></section>;
  let control;
  if (field.type === "password") control = <Input.Password value={value} onChange={(event) => onChange(event.target.value)} />;
  else if (field.type === "number") control = <InputNumber value={value === "" ? null : Number(value)} className="full-width" onChange={(next) => onChange(next == null ? "" : String(next))} />;
  else if (field.type === "switch") control = <Switch checked={value === "true"} onChange={(next) => onChange(String(next))} />;
  else if (field.type === "dropdown") control = <Select value={value || undefined} options={field.options?.map((option) => ({ value: option.value, label: option.label }))} onChange={onChange} />;
  else if (field.type === "textarea") control = <Input.TextArea value={value} autoSize={{ minRows: 3, maxRows: 8 }} onChange={(event) => onChange(event.target.value)} />;
  else control = <Input value={value} onChange={(event) => onChange(event.target.value)} />;
  return <Form.Item label={field.title} required={field.required} extra={field.summary}>{control}</Form.Item>;
}

function dependencyMatches(dependency: unknown, config: Record<string, string>): boolean {
  if (!dependency || typeof dependency !== "object") return true;
  const value = dependency as Record<string, unknown>;
  const match = value.match as { key?: unknown; value?: unknown } | undefined;
  if (match) return typeof match.key === "string" && config[match.key] === String(match.value ?? "");
  const and = value.and as { conditions?: unknown[] } | undefined;
  if (and) return Array.isArray(and.conditions) && and.conditions.every((condition) => dependencyMatches(condition, config));
  const or = value.or as { conditions?: unknown[] } | undefined;
  if (or) return Array.isArray(or.conditions) && or.conditions.some((condition) => dependencyMatches(condition, config));
  const not = value.not as { condition?: unknown } | undefined;
  return not ? !dependencyMatches(not.condition, config) : false;
}
