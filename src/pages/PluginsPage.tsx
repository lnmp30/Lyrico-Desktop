import { ApiOutlined, AppstoreAddOutlined, CheckCircleFilled, CheckCircleOutlined } from "@ant-design/icons";
import {
  Avatar,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  Descriptions,
  Menu,
  Row,
  Space,
  Switch,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AudioTrack, SourcePlugin } from "../app/types";
import { capabilityLabel } from "../data/pluginCatalog";

const { Title, Text } = Typography;

export function PluginsPage({
  plugins,
  tracks,
  onChangePlugin,
}: {
  plugins: SourcePlugin[];
  tracks: AudioTrack[];
  onChangePlugin: (plugin: SourcePlugin) => void;
}) {
  const { t } = useTranslation();
  const [selectedPluginId, setSelectedPluginId] = useState(plugins[0]?.id);
  const [consoleLines, setConsoleLines] = useState<string[]>([]);
  const selectedPlugin = plugins.find((plugin) => plugin.id === selectedPluginId) ?? plugins[0];

  const manifest = useMemo(() => {
    if (!selectedPlugin) return "";
    return JSON.stringify(
      {
        id: selectedPlugin.id,
        name: selectedPlugin.name,
        version: selectedPlugin.version,
        apiVersion: selectedPlugin.apiVersion,
        entry: selectedPlugin.entryFile,
        capabilities: selectedPlugin.capabilities,
        permissions: selectedPlugin.permissions,
      },
      null,
      2,
    );
  }, [selectedPlugin]);

  function updateConfig(key: string, value: string | number | boolean | null) {
    if (!selectedPlugin || value == null) return;
    onChangePlugin({ ...selectedPlugin, config: { ...selectedPlugin.config, [key]: value } });
  }

  function validateSourceContract() {
    if (!selectedPlugin) return;
    setConsoleLines([
      `[${timeStamp()}] Source manifest: ${selectedPlugin.name} v${selectedPlugin.version}`,
      `[${timeStamp()}] Entry file: ${selectedPlugin.entryFile}`,
      `[${timeStamp()}] Capabilities: ${selectedPlugin.capabilities.map(capabilityLabel).join(", ")}`,
      `[${timeStamp()}] Declared permissions: ${selectedPlugin.permissions.join(", ")}`,
      `[${timeStamp()}] Library tracks available: ${tracks.length}`,
    ]);
  }

  return (
    <div className="workspace page-stack">
      <Flex justify="space-between" align="start" gap={16} wrap>
        <div>
          <Title level={2}>{t("sources.title")}</Title>
          <Text type="secondary">{t("sources.description")}</Text>
        </div>
        <Button type="primary" icon={<AppstoreAddOutlined />}>{t("sources.install")}</Button>
      </Flex>

      <Row gutter={[16, 16]} align="stretch">
        <Col xs={24} lg={8} xl={7}>
          <Card title={t("sources.installed")} className="full-height-card" styles={{ body: { padding: 8 } }}>
            {plugins.length ? (
              <Menu
                mode="inline"
                className="source-menu"
                selectedKeys={selectedPlugin ? [selectedPlugin.id] : []}
                onSelect={({ key }) => setSelectedPluginId(key)}
                items={plugins.map((plugin) => ({
                  key: plugin.id,
                  icon: <Avatar shape="square" size={36} icon={<ApiOutlined />} />,
                  label: (
                    <Flex align="center" justify="space-between" gap={8}>
                      <div className="track-title-cell">
                        <Text strong ellipsis>{plugin.name}</Text>
                        <Text type="secondary" ellipsis>{plugin.capabilities.map(capabilityLabel).join(" · ")}</Text>
                      </div>
                      <Tag color={plugin.enabled ? "success" : "default"}>{plugin.enabled ? t("common.enabled") : t("common.disabled")}</Tag>
                    </Flex>
                  ),
                }))}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("sources.none")} />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={16} xl={17}>
          {selectedPlugin ? (
            <Card
              className="full-height-card"
              title={
                <Space>
                  <Avatar shape="square" icon={<ApiOutlined />} />
                  <span>{selectedPlugin.name}</span>
                  <Tag>v{selectedPlugin.version}</Tag>
                </Space>
              }
              extra={
                <Switch
                  checked={selectedPlugin.enabled}
                  checkedChildren={t("common.enabled")}
                  unCheckedChildren={t("common.disabled")}
                  onChange={(enabled) => onChangePlugin({ ...selectedPlugin, enabled })}
                />
              }
            >
              <Tabs
                items={[
                  {
                    key: "config",
                    label: t("sources.configuration"),
                    children: (
                      <Form layout="vertical" className="source-config-form">
                        {Object.entries(selectedPlugin.config).map(([key, value]) => (
                          <Form.Item key={key} label={key}>
                            {typeof value === "number" ? (
                              <InputNumber value={value} className="full-width" onChange={(next) => updateConfig(key, next)} />
                            ) : typeof value === "boolean" ? (
                              <Switch checked={value} onChange={(next) => updateConfig(key, next)} />
                            ) : (
                              <Input value={String(value)} onChange={(event) => updateConfig(key, event.target.value)} />
                            )}
                          </Form.Item>
                        ))}
                      </Form>
                    ),
                  },
                  { key: "manifest", label: t("sources.manifest"), children: <pre className="code-preview">{manifest}</pre> },
                  {
                    key: "diagnostics",
                    label: t("sources.diagnostics"),
                    children: (
                      <Space orientation="vertical" size={16} className="full-width">
                        <Text strong>{t("sources.permissions")}</Text>
                        <Descriptions
                          bordered
                          size="small"
                          column={1}
                          items={selectedPlugin.permissions.map((permission) => ({
                            key: permission,
                            label: <Space><CheckCircleFilled className="permission-dot" /><Text code>{permission}</Text></Space>,
                            children: <Tag color="success">{t("sources.allowed")}</Tag>,
                          }))}
                        />
                        <Flex justify="space-between" align="center">
                          <Text strong>{t("sources.console")}</Text>
                          <Button icon={<CheckCircleOutlined />} onClick={validateSourceContract}>{t("sources.validate")}</Button>
                        </Flex>
                        <pre className="code-preview console">{consoleLines.join("\n") || t("sources.validateHint")}</pre>
                      </Space>
                    ),
                  },
                ]}
              />
            </Card>
          ) : (
            <Card><Empty description={t("sources.select")} /></Card>
          )}
        </Col>
      </Row>
    </div>
  );
}

function timeStamp() {
  return new Date().toLocaleTimeString([], { hour12: false });
}
