import { CheckSquareOutlined, CloudSyncOutlined, CloseOutlined } from "@ant-design/icons";
import { Button, Flex, Space, Table, Tag, Typography } from "antd";
import { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AudioTrack } from "../app/types";
import { formatDuration } from "../utils/format";
import { TrackArtwork } from "./TrackArtwork";
import { useResizableColumns, type BoundedColumn } from "../hooks/useResizableColumns";

const { Text } = Typography;

export const LibraryTable = memo(function LibraryTable({
  tracks,
  loading,
  selectedPath,
  selectedPaths = [],
  onSelectTrack,
  onOpenTrack,
  onChangeSelectedPaths,
  selectionMode = false,
  onChangeSelectionMode,
  onOpenBatch,
  showSelectionToolbar = true,
}: {
  tracks: AudioTrack[];
  loading?: boolean;
  selectedPath?: string;
  selectedPaths?: string[];
  onSelectTrack: (path?: string) => void;
  onOpenTrack?: (track: AudioTrack) => void;
  onChangeSelectedPaths?: (paths: string[]) => void;
  selectionMode?: boolean;
  onChangeSelectionMode?: (enabled: boolean) => void;
  onOpenBatch?: () => void;
  showSelectionToolbar?: boolean;
}) {
  const { t } = useTranslation();

  const baseColumns: BoundedColumn<AudioTrack>[] = useMemo(() => [
    {
      title: t("table.song"),
      dataIndex: "title",
      key: "title",
      width: 360,
      minWidth: 220,
      maxWidth: 720,
      sorter: (left, right) => left.title.localeCompare(right.title),
      render: (_, track) => (
        <Space size={12} className="song-cell" title={track.fileName}>
          <TrackArtwork track={track} size={44} />
          <div className="track-title-cell">
            <Text strong ellipsis>
              {track.title || track.fileName}
            </Text>
            <Text type="secondary" ellipsis>
              {track.artist || t("common.unknownArtist")}
            </Text>
          </div>
        </Space>
      ),
    },
    {
      title: t("table.album"),
      dataIndex: "album",
      width: 220,
      minWidth: 140,
      maxWidth: 480,
      responsive: ["lg"],
      sorter: (left, right) => left.album.localeCompare(right.album),
      render: (value: string) => value || <Text type="secondary">{t("common.unknownAlbum")}</Text>,
    },
    {
      title: t("table.track"),
      dataIndex: "trackNumber",
      align: "right",
      width: 72,
      minWidth: 60,
      maxWidth: 120,
      responsive: ["lg"],
      render: (value?: number) => value ?? "—",
    },
    {
      title: t("table.duration"),
      dataIndex: "durationSeconds",
      align: "right",
      width: 100,
      minWidth: 80,
      maxWidth: 160,
      render: (value: number) => formatDuration(value),
    },
    {
      title: t("table.format"),
      dataIndex: "format",
      align: "center",
      width: 90,
      minWidth: 72,
      maxWidth: 140,
      responsive: ["xl"],
      render: (value: string) => <Tag>{value || "—"}</Tag>,
    },
  ], [t]);
  const { columns, components } = useResizableColumns(baseColumns);

  const rowSelection =
    selectionMode && onChangeSelectedPaths
      ? {
          selectedRowKeys: selectedPaths,
          preserveSelectedRowKeys: true,
          onChange: (keys: React.Key[]) => onChangeSelectedPaths(keys.map(String)),
        }
      : undefined;

  const rowClassName = useCallback((track: AudioTrack) => (track.path === selectedPath ? "row-focused" : ""), [selectedPath]);

  const onRow = useCallback((track: AudioTrack) => ({
    onClick: (event: React.MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest(".ant-table-selection-column, .ant-checkbox-wrapper, .ant-checkbox")) {
        return;
      }

      if (selectionMode && onChangeSelectedPaths) {
        onChangeSelectedPaths(
          selectedPaths.includes(track.path)
            ? selectedPaths.filter((path) => path !== track.path)
            : [...selectedPaths, track.path],
        );
      } else {
        onSelectTrack(track.path);
        onOpenTrack?.(track);
      }
    },
  }), [selectionMode, onChangeSelectedPaths, selectedPaths, onSelectTrack, onOpenTrack]);

  return (
    <div className="library-table-shell">
      {showSelectionToolbar && onChangeSelectedPaths && onChangeSelectionMode && (
        <Flex className="selection-toolbar" align="center" justify="space-between" gap={12} wrap>
          {selectionMode ? (
            <>
              <Space>
                <Button icon={<CloseOutlined />} onClick={() => onChangeSelectionMode(false)}>{t("selection.exit")}</Button>
                <Text>{t("selection.count", { count: selectedPaths.length })}</Text>
              </Space>
              <Button type="primary" icon={<CloudSyncOutlined />} disabled={selectedPaths.length === 0} onClick={onOpenBatch}>
                {t("selection.batch")}
              </Button>
            </>
          ) : (
            <Button icon={<CheckSquareOutlined />} onClick={() => onChangeSelectionMode(true)}>{t("selection.enter")}</Button>
          )}
        </Flex>
      )}
    <Table
      rowKey="path"
      loading={loading}
      columns={columns}
      components={components}
      dataSource={tracks}
      size="middle"
      tableLayout="fixed"
      pagination={false}
      virtual={tracks.length > 100}
      scroll={{ x: 520, y: tracks.length > 100 ? 600 : undefined }}
      rowSelection={rowSelection}
      rowClassName={rowClassName}
      onRow={onRow}
    />
    </div>
  );
});
