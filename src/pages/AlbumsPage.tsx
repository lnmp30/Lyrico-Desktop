import { ArrowLeftOutlined, CheckOutlined, CheckSquareOutlined, CloseOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Flex, Input, Space, Typography } from "antd";
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AudioTrack } from "../app/types";
import { LibraryTable } from "../components/LibraryTable";
import { LibrarySelectionToolbar } from "../components/LibrarySelectionToolbar";
import { TrackArtwork } from "../components/TrackArtwork";
import type { AlbumGroup } from "../domain/library";
import { formatDuration } from "../utils/format";
import { useIncrementalGrid } from "../hooks/useIncrementalGrid";

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
  const { visibleCount, sentinelRef, hasMore } = useIncrementalGrid(albums.length);
  const selectedSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);
  const fullySelectedAlbumIds = useMemo(() => albums.filter((album) => album.tracks.length > 0 && album.tracks.every((track) => selectedSet.has(track.path))).map((album) => album.id), [albums, selectedSet]);
  const changeAlbumSelection = (album: AlbumGroup, selected: boolean) => {
    const albumPaths = new Set(album.tracks.map((track) => track.path));
    onChangeSelectedPaths(selected
      ? [...new Set([...selectedPaths, ...albumPaths])]
      : selectedPaths.filter((path) => !albumPaths.has(path)));
  };

  if (detailsOpen && selectedAlbum) {
    return <div className="workspace page-stack library-view detail-subpage">
      <header className="subpage-toolbar">
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={onCloseDetails}>{t("common.back")}</Button>
      </header>
      <section className="collection-detail-hero">
        <TrackArtwork track={{ coverDataUrl: selectedAlbum.coverDataUrl, path: selectedAlbum.coverPath, hasCover: Boolean(selectedAlbum.coverPath) }} size={112} />
        <div className="collection-detail-copy">
          <Title level={1}>{selectedAlbum.title}</Title>
          <Text>{selectedAlbum.artist}</Text>
          <Text type="secondary">{t("common.trackCount", { count: selectedAlbum.trackCount })} · {formatDuration(selectedAlbum.durationSeconds)}</Text>
        </div>
      </section>
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
    </div>;
  }

  return (
    <div className="workspace page-stack library-view">
      <Flex className="library-page-header compact-library-header" justify="space-between" align="center" gap={24}>
        <div className="library-page-header-copy">
          <Title level={2}>{t("albums.title")}</Title>
          <Text type="secondary">{t("common.albumCount", { count: albums.length })}</Text>
        </div>
        <Space className="library-page-actions">
          <Input allowClear className="page-search" prefix={<SearchOutlined />} placeholder={t("search.placeholder", { scope: t("search.albums") })} value={query} onChange={(event) => onChangeQuery(event.target.value)} />
          {selectionMode ? <Button icon={<CloseOutlined />} onClick={() => onChangeSelectionMode(false)}>{t("selection.exit")}</Button> : <Button icon={<CheckSquareOutlined />} onClick={() => onChangeSelectionMode(true)}>{t("selection.selectAlbums")}</Button>}
        </Space>
      </Flex>
      <section className="collection-grid-section">
        {selectionMode ? <LibrarySelectionToolbar selectedCount={selectedPaths.length} onOpenBatch={onOpenBatch} /> : null}
        <div className="album-grid" aria-busy={loading}>
          {albums.slice(0, visibleCount).map((album) => {
            const selected = fullySelectedAlbumIds.includes(album.id);
            return <button className={`collection-tile album-tile${album.id === selectedAlbumId ? " is-current" : ""}`} key={album.id} aria-pressed={selectionMode ? selected : undefined} onClick={() => {
              if (selectionMode) changeAlbumSelection(album, !selected);
              else { onSelectAlbum(album.id); onOpenDetails(); }
            }}>
              <div className="collection-artwork-wrap">
                <TrackArtwork track={{ coverDataUrl: album.coverDataUrl, path: album.coverPath, hasCover: Boolean(album.coverPath) }} size={180} />
                {selectionMode ? <span className={`collection-select-indicator${selected ? " is-selected" : ""}`}><CheckOutlined /></span> : null}
              </div>
              <Text strong ellipsis={{ tooltip: album.title }}>{album.title}</Text>
              <Text type="secondary" ellipsis={{ tooltip: album.artist }}>{album.artist}</Text>
              <Text className="collection-meta" type="secondary">{t("common.trackCount", { count: album.trackCount })} · {formatDuration(album.durationSeconds)}</Text>
            </button>;
          })}
        </div>
        {hasMore ? <div ref={sentinelRef} className="collection-grid-sentinel" aria-hidden="true" /> : null}
      </section>
    </div>
  );
});
