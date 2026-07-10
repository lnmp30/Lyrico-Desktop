import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Card, Empty, Flex, Input, Space, Tooltip, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type { AudioTrack } from "../app/types";
import { LibraryTable } from "../components/LibraryTable";

const { Title, Text } = Typography;

export function SongsPage({
  tracks,
  query,
  selectedTrack,
  selectedPath,
  selectedPaths,
  loading,
  onChangeQuery,
  onSelectTrack,
  onChangeSelectedPaths,
  onReloadTrack,
  onOpenDetails,
}: {
  tracks: AudioTrack[];
  query: string;
  selectedTrack?: AudioTrack;
  selectedPath?: string;
  selectedPaths: string[];
  loading: boolean;
  onChangeQuery: (query: string) => void;
  onSelectTrack: (path?: string) => void;
  onChangeSelectedPaths: (paths: string[]) => void;
  onReloadTrack: () => void;
  onOpenDetails: (path?: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="workspace page-stack">
      <Flex justify="space-between" align="start" gap={16} wrap>
        <div>
          <Title level={2}>{t("songs.title")}</Title>
          <Text type="secondary">{t("songs.description")}</Text>
        </div>
        <Space wrap>
          <Input
            allowClear
            className="page-search"
            prefix={<SearchOutlined />}
            placeholder={t("search.placeholder", { scope: t("search.songs") })}
            value={query}
            onChange={(event) => onChangeQuery(event.target.value)}
          />
          <Tooltip title={t("songs.reloadHint")}>
            <Button
              aria-label={t("songs.reloadAria")}
              icon={<ReloadOutlined />}
              disabled={!selectedTrack}
              loading={loading}
              onClick={onReloadTrack}
            />
          </Tooltip>
        </Space>
      </Flex>

      <Card
        className="content-card"
        title={selectedPaths.length ? t("songs.selected", { count: selectedPaths.length }) : t("songs.all")}
        extra={<Text type="secondary">{t("common.songCount", { count: tracks.length })}</Text>}
        styles={{ body: { padding: 0 } }}
      >
        {tracks.length === 0 && !loading ? (
          <Empty className="page-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("songs.empty")} />
        ) : (
          <LibraryTable
            tracks={tracks}
            loading={loading}
            selectedPath={selectedPath}
            selectedPaths={selectedPaths}
            onSelectTrack={onSelectTrack}
            onOpenTrack={(track) => onOpenDetails(track.path)}
            onChangeSelectedPaths={onChangeSelectedPaths}
          />
        )}
      </Card>
    </div>
  );
}
