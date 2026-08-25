import { CheckSquareOutlined, CloseOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Card, Drawer, Flex, Input, Space, Table, Typography } from "antd";
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AudioTrack } from "../app/types";
import { LibraryTable } from "../components/LibraryTable";
import { LibrarySelectionToolbar } from "../components/LibrarySelectionToolbar";
import { TrackArtwork } from "../components/TrackArtwork";
import type { AlbumGroup } from "../domain/library";
import { formatDuration } from "../utils/format";
import { useResizableColumns, type BoundedColumn } from "../hooks/useResizableColumns";

const { Title, Text } = Typography;

export const AlbumsPage = memo(function AlbumsPage({
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
  selectedPaths,
  selectionMode,
  onChangeSelectedPaths,
  onChangeSelectionMode,
  onOpenBatch,
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
  selectedPaths: string[];
  selectionMode: boolean;
  onChangeSelectedPaths: (paths: string[]) => void;
  onChangeSelectionMode: (enabled: boolean) => void;
  onOpenBatch: () => void;
}) {
  const { t } = useTranslation();
  const selectedAlbum = albums.find((album) => album.id === selectedAlbumId);
  const selectedSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);
  const fullySelectedAlbumIds = useMemo(() => albums.filter((album) => album.tracks.length > 0 && album.tracks.every((track) => selectedSet.has(track.path))).map((album) => album.id), [albums, selectedSet]);
  const changeAlbumSelection = (album: AlbumGroup, selected: boolean) => {
    const albumPaths = new Set(album.tracks.map((track) => track.path));
    onChangeSelectedPaths(selected
      ? [...new Set([...selectedPaths, ...albumPaths])]
      : selectedPaths.filter((path) => !albumPaths.has(path)));
  };

  const baseColumns: BoundedColumn<AlbumGroup>[] = [
    {
      title: t("table.album"),
      dataIndex: "title",
      width: 420,
      minWidth: 240,
      maxWidth: 760,
      sorter: (left, right) => left.title.localeCompare(right.title),
      render: (_, album) => (
        <Flex align="center" gap={12}>
          <TrackArtwork track={{ coverDataUrl: album.coverDataUrl, path: album.coverPath, hasCover: Boolean(album.coverPath) }} size={46} />
          <div className="track-title-cell">
            <Text strong ellipsis>{album.title}</Text>
            <Text type="secondary" ellipsis>{album.artist}</Text>
          </div>
        </Flex>
      ),
    },
    { title: t("common.songs"), dataIndex: "trackCount", width: 100, minWidth: 80, maxWidth: 160, align: "right" },
    {
      title: t("table.duration"),
      dataIndex: "durationSeconds",
      width: 120,
      minWidth: 90,
      maxWidth: 180,
      align: "right",
      responsive: ["md"],
      render: (value: number) => formatDuration(value),
    },
  ];
  const { columns, components } = useResizableColumns(baseColumns);

  return (
    <div className="workspace page-stack">
      <Flex className="library-page-header" justify="space-between" align="start" gap={16}>
        <div className="library-page-header-copy">
          <Title level={2}>{t("albums.title")}</Title>
          <Text type="secondary">{t("albums.description")}</Text>
        </div>
        <Space className="library-page-actions">
          <Input allowClear className="page-search" prefix={<SearchOutlined />} placeholder={t("search.placeholder", { scope: t("search.albums") })} value={query} onChange={(event) => onChangeQuery(event.target.value)} />
          {selectionMode ? <Button icon={<CloseOutlined />} onClick={() => onChangeSelectionMode(false)}>{t("selection.exit")}</Button> : <Button icon={<CheckSquareOutlined />} onClick={() => onChangeSelectionMode(true)}>{t("selection.selectAlbums")}</Button>}
        </Space>
      </Flex>
      <Card
        className="content-card"
        title={selectedPaths.length ? t("albums.selected", { count: selectedPaths.length }) : t("albums.all")}
        extra={<Text type="secondary">{t("common.albumCount", { count: albums.length })}</Text>}
        styles={{ body: { padding: 0 } }}
      >
        {selectionMode ? <LibrarySelectionToolbar selectedCount={selectedPaths.length} onOpenBatch={onOpenBatch} /> : null}
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          components={components}
          dataSource={albums}
          rowSelection={selectionMode ? {
            selectedRowKeys: fullySelectedAlbumIds,
            onSelect: (album, selected) => changeAlbumSelection(album, selected),
            onSelectAll: (selected) => {
              const visiblePaths = new Set(albums.flatMap((album) => album.tracks.map((track) => track.path)));
              onChangeSelectedPaths(selected ? [...new Set([...selectedPaths, ...visiblePaths])] : selectedPaths.filter((path) => !visiblePaths.has(path)));
            },
            getCheckboxProps: (album) => ({ indeterminate: album.tracks.some((track) => selectedSet.has(track.path)) && !album.tracks.every((track) => selectedSet.has(track.path)) }),
          } : undefined}
          size="middle"
          tableLayout="fixed"
          pagination={false}
          scroll={{ x: 560 }}
          rowClassName={(album) => (album.id === selectedAlbumId ? "row-focused" : "")}
          onRow={(album) => ({ onClick: (event) => {
            if ((event.target as HTMLElement).closest(".ant-table-selection-column, .ant-checkbox-wrapper, .ant-checkbox")) return;
            if (selectionMode) changeAlbumSelection(album, !fullySelectedAlbumIds.includes(album.id));
            else onSelectAlbum(album.id);
          }, onDoubleClick: selectionMode ? undefined : onOpenDetails })}
        />
      </Card>

      <Drawer title={selectedAlbum?.title ?? t("albums.drawer")} size={720} open={detailsOpen && Boolean(selectedAlbum)} onClose={onCloseDetails}>
        {selectedAlbum && (
          <>
            <Space size={14} align="start" className="collection-summary">
              <TrackArtwork track={{ coverDataUrl: selectedAlbum.coverDataUrl, path: selectedAlbum.coverPath, hasCover: Boolean(selectedAlbum.coverPath) }} size={72} />
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
              selectedPaths={selectedPaths}
              onChangeSelectedPaths={onChangeSelectedPaths}
              selectionMode={selectionMode}
              onChangeSelectionMode={onChangeSelectionMode}
              onOpenBatch={onOpenBatch}
            />
          </>
        )}
      </Drawer>
    </div>
  );
});
