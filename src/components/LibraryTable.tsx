import { Space, Table, Tag, Tooltip, Typography, type TableColumnsType, type TableProps } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AudioTrack } from "../app/types";
import { useTrackCovers } from "../hooks/useTrackCovers";
import { formatDuration } from "../utils/format";
import { TrackArtwork } from "./TrackArtwork";

const { Text } = Typography;

export function LibraryTable({
  tracks,
  loading,
  selectedPath,
  selectedPaths = [],
  onSelectTrack,
  onOpenTrack,
  onChangeSelectedPaths,
  pageSize = 20,
  selectable = true,
}: {
  tracks: AudioTrack[];
  loading?: boolean;
  selectedPath?: string;
  selectedPaths?: string[];
  onSelectTrack: (path?: string) => void;
  onOpenTrack?: (track: AudioTrack) => void;
  onChangeSelectedPaths?: (paths: string[]) => void;
  pageSize?: number;
  selectable?: boolean;
}) {
  const { t } = useTranslation();
  const [currentPage, setCurrentPage] = useState(1);
  const [currentPageSize, setCurrentPageSize] = useState(pageSize);
  const [coverPaths, setCoverPaths] = useState(() => pageCoverPaths(tracks, 1, pageSize));
  const covers = useTrackCovers(coverPaths);

  useEffect(() => {
    setCurrentPage(1);
    setCoverPaths(pageCoverPaths(tracks, 1, currentPageSize));
  }, [tracks, currentPageSize]);

  const columns: TableColumnsType<AudioTrack> = [
    {
      title: t("table.song"),
      dataIndex: "title",
      key: "title",
      sorter: (left, right) => left.title.localeCompare(right.title),
      render: (_, track) => (
        <Tooltip title={track.fileName} placement="topLeft">
          <Space size={12} className="song-cell">
            <TrackArtwork track={{ coverDataUrl: track.coverDataUrl ?? covers.get(track.path) }} size={44} />
            <div className="track-title-cell">
              <Text strong ellipsis>
                {track.title || track.fileName}
              </Text>
              <Text type="secondary" ellipsis>
                {track.artist || t("common.unknownArtist")}
              </Text>
            </div>
          </Space>
        </Tooltip>
      ),
    },
    {
      title: t("table.album"),
      dataIndex: "album",
      width: 220,
      responsive: ["lg"],
      sorter: (left, right) => left.album.localeCompare(right.album),
      render: (value: string) => value || <Text type="secondary">{t("common.unknownAlbum")}</Text>,
    },
    {
      title: t("table.track"),
      dataIndex: "trackNumber",
      align: "right",
      width: 72,
      responsive: ["lg"],
      render: (value?: number) => value ?? "—",
    },
    {
      title: t("table.duration"),
      dataIndex: "durationSeconds",
      align: "right",
      width: 100,
      render: (value: number) => formatDuration(value),
    },
    {
      title: t("table.format"),
      dataIndex: "format",
      align: "center",
      width: 90,
      responsive: ["xl"],
      render: (value: string) => <Tag>{value || "—"}</Tag>,
    },
  ];

  const rowSelection =
    selectable && onChangeSelectedPaths
      ? {
          selectedRowKeys: selectedPaths,
          preserveSelectedRowKeys: true,
          onChange: (keys: React.Key[]) => onChangeSelectedPaths(keys.map(String)),
        }
      : undefined;

  const handleChange: TableProps<AudioTrack>["onChange"] = (pagination, _filters, _sorter, extra) => {
    const nextPage = pagination.current ?? 1;
    const nextPageSize = pagination.pageSize ?? currentPageSize;
    setCurrentPage(nextPage);
    setCurrentPageSize(nextPageSize);
    setCoverPaths(pageCoverPaths(extra.currentDataSource, nextPage, nextPageSize));
  };

  return (
    <Table
      rowKey="path"
      loading={loading}
      columns={columns}
      dataSource={tracks}
      size="middle"
      tableLayout="fixed"
      pagination={{
        current: currentPage,
        pageSize: currentPageSize,
        showSizeChanger: tracks.length > pageSize,
        pageSizeOptions: [10, 20, 50, 100],
        showTotal: (total, range) => t("table.range", { start: range[0], end: range[1], total }),
      }}
      scroll={{ x: 520 }}
      rowSelection={rowSelection}
      onChange={handleChange}
      rowClassName={(track) => (track.path === selectedPath ? "row-focused" : "")}
      onRow={(track) => ({
        onClick: (event) => {
          const target = event.target as HTMLElement;
          if (target.closest(".ant-table-selection-column, .ant-checkbox-wrapper, .ant-checkbox")) {
            return;
          }

          onSelectTrack(track.path);
          onOpenTrack?.(track);
        },
      })}
    />
  );
}

function pageCoverPaths(tracks: AudioTrack[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return tracks
    .slice(start, start + pageSize)
    .filter((track) => track.hasCover && !track.coverDataUrl)
    .map((track) => track.path);
}
