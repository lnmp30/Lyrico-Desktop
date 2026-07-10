import { SearchOutlined } from "@ant-design/icons";
import { Card, Drawer, Flex, Input, Space, Table, Typography, type TableColumnsType, type TableProps } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AudioTrack } from "../app/types";
import { LibraryTable } from "../components/LibraryTable";
import { TrackArtwork } from "../components/TrackArtwork";
import type { AlbumGroup } from "../domain/library";
import { useTrackCovers } from "../hooks/useTrackCovers";
import { formatDuration } from "../utils/format";

const { Title, Text } = Typography;

export function AlbumsPage({
  albums,
  query,
  selectedAlbumId,
  selectedPath,
  detailsOpen,
  loading,
  onChangeQuery,
  onSelectAlbum,
  onSelectTrack,
  onOpenTrack,
  onOpenDetails,
  onCloseDetails,
}: {
  albums: AlbumGroup[];
  query: string;
  selectedAlbumId?: string;
  selectedPath?: string;
  detailsOpen: boolean;
  loading: boolean;
  onChangeQuery: (query: string) => void;
  onSelectAlbum: (albumId?: string) => void;
  onSelectTrack: (path?: string) => void;
  onOpenTrack: (path: string) => void;
  onOpenDetails: () => void;
  onCloseDetails: () => void;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [coverPaths, setCoverPaths] = useState(() => groupCoverPaths(albums, 1, 20));
  const covers = useTrackCovers(coverPaths);
  const selectedAlbum = albums.find((album) => album.id === selectedAlbumId);

  useEffect(() => {
    setPage(1);
    setCoverPaths(groupCoverPaths(albums, 1, pageSize));
  }, [albums, pageSize]);

  const columns: TableColumnsType<AlbumGroup> = [
    {
      title: t("table.album"),
      dataIndex: "title",
      sorter: (left, right) => left.title.localeCompare(right.title),
      render: (_, album) => (
        <Flex align="center" gap={12}>
          <TrackArtwork track={{ coverDataUrl: album.coverDataUrl ?? covers.get(album.coverPath ?? "") }} size={46} />
          <div className="track-title-cell">
            <Text strong ellipsis>{album.title}</Text>
            <Text type="secondary" ellipsis>{album.artist}</Text>
          </div>
        </Flex>
      ),
    },
    { title: t("common.songs"), dataIndex: "trackCount", width: 100, align: "right" },
    {
      title: t("table.duration"),
      dataIndex: "durationSeconds",
      width: 120,
      align: "right",
      responsive: ["md"],
      render: (value: number) => formatDuration(value),
    },
  ];

  const handleChange: TableProps<AlbumGroup>["onChange"] = (pagination, _filters, _sorter, extra) => {
    const nextPage = pagination.current ?? 1;
    const nextPageSize = pagination.pageSize ?? pageSize;
    setPage(nextPage);
    setPageSize(nextPageSize);
    setCoverPaths(groupCoverPaths(extra.currentDataSource, nextPage, nextPageSize));
  };

  return (
    <div className="workspace page-stack">
      <Flex justify="space-between" align="start" gap={16} wrap>
        <div>
          <Title level={2}>{t("albums.title")}</Title>
          <Text type="secondary">{t("albums.description")}</Text>
        </div>
        <Input
          allowClear
          className="page-search"
          prefix={<SearchOutlined />}
          placeholder={t("search.placeholder", { scope: t("search.albums") })}
          value={query}
          onChange={(event) => onChangeQuery(event.target.value)}
        />
      </Flex>
      <Card className="content-card" styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={albums}
          size="middle"
          tableLayout="fixed"
          pagination={{ current: page, pageSize, showSizeChanger: true, showTotal: (total) => t("common.albumCount", { count: total }) }}
          scroll={{ x: 560 }}
          onChange={handleChange}
          rowClassName={(album) => (album.id === selectedAlbumId ? "row-focused" : "")}
          onRow={(album) => ({ onClick: () => onSelectAlbum(album.id), onDoubleClick: onOpenDetails })}
        />
      </Card>

      <Drawer title={selectedAlbum?.title ?? t("albums.drawer")} size={720} open={detailsOpen && Boolean(selectedAlbum)} onClose={onCloseDetails}>
        {selectedAlbum && (
          <>
            <Space size={14} align="start" className="collection-summary">
              <TrackArtwork track={{ coverDataUrl: selectedAlbum.coverDataUrl ?? covers.get(selectedAlbum.coverPath ?? "") }} size={72} />
              <Space orientation="vertical" size={2}>
                <Text strong>{selectedAlbum.artist}</Text>
                <Text type="secondary">{t("common.trackCount", { count: selectedAlbum.trackCount })} · {formatDuration(selectedAlbum.durationSeconds)}</Text>
              </Space>
            </Space>
            <LibraryTable
              tracks={selectedAlbum.tracks as AudioTrack[]}
              selectedPath={selectedPath}
              onSelectTrack={onSelectTrack}
              onOpenTrack={(track) => onOpenTrack(track.path)}
              pageSize={10}
              selectable={false}
            />
          </>
        )}
      </Drawer>
    </div>
  );
}

function groupCoverPaths(albums: AlbumGroup[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return albums.slice(start, start + pageSize).flatMap((album) => album.coverPath && !album.coverDataUrl ? [album.coverPath] : []);
}
