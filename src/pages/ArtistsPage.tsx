import { CheckSquareOutlined, CloseOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Card, Drawer, Flex, Input, Space, Table, Typography } from "antd";
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { LibraryTable } from "../components/LibraryTable";
import { LibrarySelectionToolbar } from "../components/LibrarySelectionToolbar";
import { TrackArtwork } from "../components/TrackArtwork";
import type { ArtistGroup } from "../domain/library";
import { formatDuration } from "../utils/format";
import { useResizableColumns, type BoundedColumn } from "../hooks/useResizableColumns";

const { Title, Text } = Typography;

export const ArtistsPage = memo(function ArtistsPage({
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
  selectedPaths,
  selectionMode,
  onChangeSelectedPaths,
  onChangeSelectionMode,
  onOpenBatch,
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
  selectedPaths: string[];
  selectionMode: boolean;
  onChangeSelectedPaths: (paths: string[]) => void;
  onChangeSelectionMode: (enabled: boolean) => void;
  onOpenBatch: () => void;
}) {
  const { t } = useTranslation();
  const selectedArtist = artists.find((artist) => artist.id === selectedArtistId);
  const selectedSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);
  const fullySelectedArtistIds = useMemo(() => artists.filter((artist) => artist.tracks.length > 0 && artist.tracks.every((track) => selectedSet.has(track.path))).map((artist) => artist.id), [artists, selectedSet]);
  const changeArtistSelection = (artist: ArtistGroup, selected: boolean) => {
    const artistPaths = new Set(artist.tracks.map((track) => track.path));
    onChangeSelectedPaths(selected
      ? [...new Set([...selectedPaths, ...artistPaths])]
      : selectedPaths.filter((path) => !artistPaths.has(path)));
  };

  const baseColumns: BoundedColumn<ArtistGroup>[] = [
    {
      title: t("common.artists"),
      dataIndex: "name",
      width: 380,
      minWidth: 220,
      maxWidth: 720,
      sorter: (left, right) => left.name.localeCompare(right.name),
      render: (_, artist) => (
        <Flex align="center" gap={12}>
          <TrackArtwork track={{ coverDataUrl: artist.coverDataUrl, path: artist.coverPath, hasCover: Boolean(artist.coverPath) }} size={46} />
          <Text strong ellipsis>{artist.name}</Text>
        </Flex>
      ),
    },
    { title: t("common.albums"), dataIndex: "albumCount", width: 100, minWidth: 80, maxWidth: 160, align: "right" },
    { title: t("common.songs"), dataIndex: "trackCount", width: 100, minWidth: 80, maxWidth: 160, align: "right" },
    { title: t("table.duration"), dataIndex: "durationSeconds", width: 120, minWidth: 90, maxWidth: 180, align: "right", responsive: ["md"], render: (value: number) => formatDuration(value) },
  ];
  const { columns, components } = useResizableColumns(baseColumns);

  return (
    <div className="workspace page-stack">
      <Flex className="library-page-header" justify="space-between" align="start" gap={16}>
        <div className="library-page-header-copy">
          <Title level={2}>{t("artists.title")}</Title>
          <Text type="secondary">{t("artists.description")}</Text>
        </div>
        <Space className="library-page-actions">
          <Input allowClear className="page-search" prefix={<SearchOutlined />} placeholder={t("search.placeholder", { scope: t("search.artists") })} value={query} onChange={(event) => onChangeQuery(event.target.value)} />
          {selectionMode ? <Button icon={<CloseOutlined />} onClick={() => onChangeSelectionMode(false)}>{t("selection.exit")}</Button> : <Button icon={<CheckSquareOutlined />} onClick={() => onChangeSelectionMode(true)}>{t("selection.selectArtists")}</Button>}
        </Space>
      </Flex>
      <Card
        className="content-card"
        title={selectedPaths.length ? t("artists.selected", { count: selectedPaths.length }) : t("artists.all")}
        extra={<Text type="secondary">{t("common.artistCount", { count: artists.length })}</Text>}
        styles={{ body: { padding: 0 } }}
      >
        {selectionMode ? <LibrarySelectionToolbar selectedCount={selectedPaths.length} onOpenBatch={onOpenBatch} /> : null}
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          components={components}
          dataSource={artists}
          rowSelection={selectionMode ? {
            selectedRowKeys: fullySelectedArtistIds,
            onSelect: (artist, selected) => changeArtistSelection(artist, selected),
            onSelectAll: (selected) => {
              const visiblePaths = new Set(artists.flatMap((artist) => artist.tracks.map((track) => track.path)));
              onChangeSelectedPaths(selected ? [...new Set([...selectedPaths, ...visiblePaths])] : selectedPaths.filter((path) => !visiblePaths.has(path)));
            },
            getCheckboxProps: (artist) => ({ indeterminate: artist.tracks.some((track) => selectedSet.has(track.path)) && !artist.tracks.every((track) => selectedSet.has(track.path)) }),
          } : undefined}
          size="middle"
          tableLayout="fixed"
          pagination={false}
          scroll={{ x: 600 }}
          rowClassName={(artist) => (artist.id === selectedArtistId ? "row-focused" : "")}
          onRow={(artist) => ({ onClick: (event) => {
            if ((event.target as HTMLElement).closest(".ant-table-selection-column, .ant-checkbox-wrapper, .ant-checkbox")) return;
            if (selectionMode) changeArtistSelection(artist, !fullySelectedArtistIds.includes(artist.id));
            else onSelectArtist(artist.id);
          }, onDoubleClick: selectionMode ? undefined : onOpenDetails })}
        />
      </Card>

      <Drawer title={selectedArtist?.name ?? t("artists.drawer")} size={720} open={detailsOpen && Boolean(selectedArtist)} onClose={onCloseDetails}>
        {selectedArtist && (
          <>
            <Space size={14} align="start" className="collection-summary">
              <TrackArtwork track={{ coverDataUrl: selectedArtist.coverDataUrl, path: selectedArtist.coverPath, hasCover: Boolean(selectedArtist.coverPath) }} size={72} />
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
