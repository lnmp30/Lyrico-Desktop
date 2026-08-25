import { ArrowLeftOutlined, CheckOutlined, CheckSquareOutlined, CloseOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Flex, Input, Space, Typography } from "antd";
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { LibraryTable } from "../components/LibraryTable";
import { LibrarySelectionToolbar } from "../components/LibrarySelectionToolbar";
import { TrackArtwork } from "../components/TrackArtwork";
import type { ArtistGroup } from "../domain/library";
import { formatDuration } from "../utils/format";
import { useIncrementalGrid } from "../hooks/useIncrementalGrid";

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
  const { visibleCount, sentinelRef, hasMore } = useIncrementalGrid(artists.length);
  const selectedSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);
  const fullySelectedArtistIds = useMemo(() => artists.filter((artist) => artist.tracks.length > 0 && artist.tracks.every((track) => selectedSet.has(track.path))).map((artist) => artist.id), [artists, selectedSet]);
  const changeArtistSelection = (artist: ArtistGroup, selected: boolean) => {
    const artistPaths = new Set(artist.tracks.map((track) => track.path));
    onChangeSelectedPaths(selected
      ? [...new Set([...selectedPaths, ...artistPaths])]
      : selectedPaths.filter((path) => !artistPaths.has(path)));
  };

  if (detailsOpen && selectedArtist) {
    return <div className="workspace page-stack library-view detail-subpage">
      <header className="subpage-toolbar">
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={onCloseDetails}>{t("common.back")}</Button>
      </header>
      <section className="collection-detail-hero artist-detail-hero">
        <TrackArtwork track={{ coverDataUrl: selectedArtist.coverDataUrl, path: selectedArtist.coverPath, hasCover: Boolean(selectedArtist.coverPath) }} size={112} />
        <div className="collection-detail-copy">
          <Title level={1}>{selectedArtist.name}</Title>
          <Text>{t("common.albumCount", { count: selectedArtist.albumCount })}</Text>
          <Text type="secondary">{t("common.songCount", { count: selectedArtist.trackCount })} · {formatDuration(selectedArtist.durationSeconds)}</Text>
        </div>
      </section>
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
    </div>;
  }

  return (
    <div className="workspace page-stack library-view">
      <Flex className="library-page-header compact-library-header" justify="space-between" align="center" gap={24}>
        <div className="library-page-header-copy">
          <Title level={2}>{t("artists.title")}</Title>
          <Text type="secondary">{t("common.artistCount", { count: artists.length })}</Text>
        </div>
        <Space className="library-page-actions">
          <Input allowClear className="page-search" prefix={<SearchOutlined />} placeholder={t("search.placeholder", { scope: t("search.artists") })} value={query} onChange={(event) => onChangeQuery(event.target.value)} />
          {selectionMode ? <Button icon={<CloseOutlined />} onClick={() => onChangeSelectionMode(false)}>{t("selection.exit")}</Button> : <Button icon={<CheckSquareOutlined />} onClick={() => onChangeSelectionMode(true)}>{t("selection.selectArtists")}</Button>}
        </Space>
      </Flex>
      <section className="collection-grid-section">
        {selectionMode ? <LibrarySelectionToolbar selectedCount={selectedPaths.length} onOpenBatch={onOpenBatch} /> : null}
        <div className="artist-grid" aria-busy={loading}>
          {artists.slice(0, visibleCount).map((artist) => {
            const selected = fullySelectedArtistIds.includes(artist.id);
            return <button className={`collection-tile artist-tile${artist.id === selectedArtistId ? " is-current" : ""}`} key={artist.id} aria-pressed={selectionMode ? selected : undefined} onClick={() => {
              if (selectionMode) changeArtistSelection(artist, !selected);
              else { onSelectArtist(artist.id); onOpenDetails(); }
            }}>
              <div className="collection-artwork-wrap">
                <TrackArtwork track={{ coverDataUrl: artist.coverDataUrl, path: artist.coverPath, hasCover: Boolean(artist.coverPath) }} size={156} />
                {selectionMode ? <span className={`collection-select-indicator${selected ? " is-selected" : ""}`}><CheckOutlined /></span> : null}
              </div>
              <Text strong ellipsis={{ tooltip: artist.name }}>{artist.name}</Text>
              <Text className="collection-meta" type="secondary">{t("common.albumCount", { count: artist.albumCount })} · {t("common.songCount", { count: artist.trackCount })}</Text>
            </button>;
          })}
        </div>
        {hasMore ? <div ref={sentinelRef} className="collection-grid-sentinel" aria-hidden="true" /> : null}
      </section>
    </div>
  );
});
