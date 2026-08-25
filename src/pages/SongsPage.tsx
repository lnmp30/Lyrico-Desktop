import { CheckSquareOutlined, CloseOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Card, Empty, Flex, Input, Space, Tooltip, Typography } from "antd";
import { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { AudioTrack } from "../app/types";
import { LibraryTable } from "../components/LibraryTable";
import { LibrarySelectionToolbar } from "../components/LibrarySelectionToolbar";

const { Title, Text } = Typography;

export const SongsPage = memo(function SongsPage({
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
  selectionMode,
  onChangeSelectionMode,
  onOpenBatch,
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
  selectionMode: boolean;
  onChangeSelectionMode: (enabled: boolean) => void;
  onOpenBatch: () => void;
}) {
  const { t } = useTranslation();
  const handleOpenTrack = useCallback((track: AudioTrack) => onOpenDetails(track.path), [onOpenDetails]);
  return (
    <div className="workspace page-stack">
      <Flex className="library-page-header" justify="space-between" align="start" gap={16}>
        <div className="library-page-header-copy">
          <Title level={2}>{t("songs.title")}</Title>
          <Text type="secondary">{t("songs.description")}</Text>
        </div>
        <Space className="library-page-actions">
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
          {selectionMode ? (
            <Button icon={<CloseOutlined />} onClick={() => onChangeSelectionMode(false)}>{t("selection.exit")}</Button>
          ) : (
            <Button icon={<CheckSquareOutlined />} onClick={() => onChangeSelectionMode(true)}>{t("selection.enter")}</Button>
          )}
        </Space>
      </Flex>

      <Card
        className="content-card"
        title={selectedPaths.length ? t("songs.selected", { count: selectedPaths.length }) : t("songs.all")}
        extra={<Text type="secondary">{t("common.songCount", { count: tracks.length })}</Text>}
        styles={{ body: { padding: 0 } }}
      >
        {selectionMode ? <LibrarySelectionToolbar selectedCount={selectedPaths.length} onOpenBatch={onOpenBatch} /> : null}
        {tracks.length === 0 && !loading ? (
          <Empty className="page-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("songs.empty")} />
        ) : (
          <LibraryTable
            tracks={tracks}
            loading={loading}
            selectedPath={selectedPath}
            selectedPaths={selectedPaths}
            onSelectTrack={onSelectTrack}
            onOpenTrack={handleOpenTrack}
            onChangeSelectedPaths={onChangeSelectedPaths}
            selectionMode={selectionMode}
            onChangeSelectionMode={onChangeSelectionMode}
            onOpenBatch={onOpenBatch}
            showSelectionToolbar={false}
          />
        )}
      </Card>
    </div>
  );
});
