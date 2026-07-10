import { SearchOutlined } from "@ant-design/icons";
import { Card, Drawer, Flex, Input, Space, Table, Typography, type TableColumnsType, type TableProps } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LibraryTable } from "../components/LibraryTable";
import { TrackArtwork } from "../components/TrackArtwork";
import type { ArtistGroup } from "../domain/library";
import { useTrackCovers } from "../hooks/useTrackCovers";
import { formatDuration } from "../utils/format";

const { Title, Text } = Typography;

export function ArtistsPage({
  artists,
  query,
  selectedArtistId,
  selectedPath,
  detailsOpen,
  loading,
  onChangeQuery,
  onSelectArtist,
  onSelectTrack,
  onOpenTrack,
  onOpenDetails,
  onCloseDetails,
}: {
  artists: ArtistGroup[];
  query: string;
  selectedArtistId?: string;
  selectedPath?: string;
  detailsOpen: boolean;
  loading: boolean;
  onChangeQuery: (query: string) => void;
  onSelectArtist: (artistId?: string) => void;
  onSelectTrack: (path?: string) => void;
  onOpenTrack: (path: string) => void;
  onOpenDetails: () => void;
  onCloseDetails: () => void;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [coverPaths, setCoverPaths] = useState(() => groupCoverPaths(artists, 1, 20));
  const covers = useTrackCovers(coverPaths);
  const selectedArtist = artists.find((artist) => artist.id === selectedArtistId);

  useEffect(() => {
    setPage(1);
    setCoverPaths(groupCoverPaths(artists, 1, pageSize));
  }, [artists, pageSize]);

  const columns: TableColumnsType<ArtistGroup> = [
    {
      title: t("common.artists"),
      dataIndex: "name",
      sorter: (left, right) => left.name.localeCompare(right.name),
      render: (_, artist) => (
        <Flex align="center" gap={12}>
          <TrackArtwork track={{ coverDataUrl: artist.coverDataUrl ?? covers.get(artist.coverPath ?? "") }} size={46} />
          <Text strong ellipsis>{artist.name}</Text>
        </Flex>
      ),
    },
    { title: t("common.albums"), dataIndex: "albumCount", width: 100, align: "right" },
    { title: t("common.songs"), dataIndex: "trackCount", width: 100, align: "right" },
    { title: t("table.duration"), dataIndex: "durationSeconds", width: 120, align: "right", responsive: ["md"], render: (value: number) => formatDuration(value) },
  ];

  const handleChange: TableProps<ArtistGroup>["onChange"] = (pagination, _filters, _sorter, extra) => {
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
          <Title level={2}>{t("artists.title")}</Title>
          <Text type="secondary">{t("artists.description")}</Text>
        </div>
        <Input allowClear className="page-search" prefix={<SearchOutlined />} placeholder={t("search.placeholder", { scope: t("search.artists") })} value={query} onChange={(event) => onChangeQuery(event.target.value)} />
      </Flex>
      <Card className="content-card" styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={artists}
          size="middle"
          tableLayout="fixed"
          pagination={{ current: page, pageSize, showSizeChanger: true, showTotal: (total) => t("common.artistCount", { count: total, defaultValue: `${total} artists` }) }}
          scroll={{ x: 600 }}
          onChange={handleChange}
          rowClassName={(artist) => (artist.id === selectedArtistId ? "row-focused" : "")}
          onRow={(artist) => ({ onClick: () => onSelectArtist(artist.id), onDoubleClick: onOpenDetails })}
        />
      </Card>

      <Drawer title={selectedArtist?.name ?? t("artists.drawer")} size={720} open={detailsOpen && Boolean(selectedArtist)} onClose={onCloseDetails}>
        {selectedArtist && (
          <>
            <Space size={14} align="start" className="collection-summary">
              <TrackArtwork track={{ coverDataUrl: selectedArtist.coverDataUrl ?? covers.get(selectedArtist.coverPath ?? "") }} size={72} />
              <Space orientation="vertical" size={2}>
                <Text>{t("common.albumCount", { count: selectedArtist.albumCount })}</Text>
                <Text type="secondary">{t("common.songCount", { count: selectedArtist.trackCount })} · {formatDuration(selectedArtist.durationSeconds)}</Text>
              </Space>
            </Space>
            <LibraryTable
              tracks={selectedArtist.tracks}
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

function groupCoverPaths(artists: ArtistGroup[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return artists.slice(start, start + pageSize).flatMap((artist) => artist.coverPath && !artist.coverDataUrl ? [artist.coverPath] : []);
}
