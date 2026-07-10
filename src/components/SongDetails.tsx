import { ReloadOutlined, SaveOutlined } from "@ant-design/icons";
import { Button, Descriptions, Divider, Drawer, Flex, Form, Input, InputNumber, Select, Space, Spin, Tag, Typography } from "antd";
import type { FormInstance } from "antd";
import { useTranslation } from "react-i18next";
import type { AudioTrack, TagForm } from "../app/types";
import { formatTechnical } from "../utils/format";
import { TrackArtwork } from "./TrackArtwork";

const { Text } = Typography;

export function SongDetails({
  open,
  loading,
  track,
  form,
  saving,
  onSave,
  onReload,
  onClose,
}: {
  open: boolean;
  loading: boolean;
  track?: AudioTrack;
  form: FormInstance<TagForm>;
  saving: boolean;
  onSave: () => void;
  onReload: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Drawer
      title={t("details.title")}
      placement="right"
      size={480}
      open={open}
      forceRender
      onClose={onClose}
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} disabled={!track} onClick={onReload}>
            {t("common.reload")}
          </Button>
          <Button type="primary" icon={<SaveOutlined />} disabled={!track} loading={saving} onClick={onSave}>
            {t("common.save")}
          </Button>
        </Space>
      }
    >
      {loading ? (
        <div className="drawer-loading"><Spin tip={t("details.loading")} /></div>
      ) : !track ? (
        <Form form={form} component={false} />
      ) : (
        <>
          <Space size={16} align="start" className="detail-summary">
            <TrackArtwork track={track} size={88} />
            <Space orientation="vertical" size={2} className="detail-summary-copy">
              <Text strong className="detail-title" ellipsis={{ tooltip: track.title }}>
                {track.title || track.fileName}
              </Text>
              <Text>{track.artist || t("common.unknownArtist")}</Text>
              <Text type="secondary">{track.album || t("common.unknownAlbum")}</Text>
              <Text type="secondary">{formatTechnical(track)}</Text>
            </Space>
          </Space>

          <Form form={form} layout="vertical" requiredMark={false} className="tag-form">
            <Form.Item name="title" label={t("details.titleField")}>
              <Input />
            </Form.Item>
            <Form.Item name="artist" label={t("details.artist")}>
              <Input />
            </Form.Item>
            <Form.Item name="album" label={t("details.album")}>
              <Input />
            </Form.Item>
            <Form.Item name="albumArtist" label={t("details.albumArtist")}>
              <Input />
            </Form.Item>
            <Flex gap={12} wrap>
              <Form.Item name="trackNumber" label={t("details.track")} className="compact-field">
                <InputNumber min={1} precision={0} className="full-width" />
              </Form.Item>
              <Form.Item name="discNumber" label={t("details.disc")} className="compact-field">
                <InputNumber min={1} precision={0} className="full-width" />
              </Form.Item>
              <Form.Item name="year" label={t("details.year")} className="compact-field">
                <Input />
              </Form.Item>
            </Flex>
            <Form.Item name="genre" label={t("details.genre")}>
              <Select
                showSearch
                allowClear
                options={["J-Pop", "Pop", "Rock", "Electronic", "Classical", "Hip-Hop"].map((value) => ({
                  value,
                  label: value,
                }))}
              />
            </Form.Item>
            <Form.Item name="comment" label={t("details.comment")}>
              <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} />
            </Form.Item>
            <Form.Item name="lyrics" label={t("details.lyrics")}>
              <Input.TextArea autoSize={{ minRows: 5, maxRows: 12 }} />
            </Form.Item>
          </Form>

          <Divider />
          <Descriptions
            size="small"
            column={1}
            items={[
              {
                key: "lyrics",
                label: t("details.lyrics"),
                children: <Tag color={track.hasLyrics ? "success" : "default"}>{track.hasLyrics ? t("details.found") : t("details.missing")}</Tag>,
              },
              {
                key: "cover",
                label: t("details.cover"),
                children: <Tag color={track.hasCover ? "success" : "default"}>{track.hasCover ? t("details.embedded") : t("details.missing")}</Tag>,
              },
              {
                key: "path",
                label: t("details.file"),
                children: (
                  <Text type="secondary" copyable={{ text: track.path }} className="file-path">
                    {track.path}
                  </Text>
                ),
              },
            ]}
          />
        </>
      )}
    </Drawer>
  );
}
