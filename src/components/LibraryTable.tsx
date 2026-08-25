import { CheckSquareOutlined, CloudSyncOutlined, CloseOutlined } from "@ant-design/icons";
import { Button, Checkbox, Flex, Space, Tag, Typography } from "antd";
import { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { AudioTrack } from "../app/types";
import { formatDuration } from "../utils/format";
import { TrackArtwork } from "./TrackArtwork";

const { Text } = Typography;

export const LibraryTable = memo(function LibraryTable({ tracks, loading, selectedPath, selectedPaths = [], onSelectTrack, onOpenTrack, onChangeSelectedPaths, selectionMode = false, onChangeSelectionMode, onOpenBatch, showSelectionToolbar = true }: {
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
  const toggleTrack = useCallback((track: AudioTrack) => {
    if (!onChangeSelectedPaths) return;
    onChangeSelectedPaths(selectedPaths.includes(track.path) ? selectedPaths.filter((path) => path !== track.path) : [...selectedPaths, track.path]);
  }, [onChangeSelectedPaths, selectedPaths]);
  const openTrack = useCallback((track: AudioTrack) => {
    if (selectionMode) toggleTrack(track);
    else {
      onSelectTrack(track.path);
      onOpenTrack?.(track);
    }
  }, [onOpenTrack, onSelectTrack, selectionMode, toggleTrack]);

  return (
    <div className="library-track-list">
      {showSelectionToolbar && onChangeSelectedPaths && onChangeSelectionMode ? (
        <Flex className="selection-toolbar" align="center" justify="space-between" gap={12} wrap>
          {selectionMode ? <>
            <Space><Button icon={<CloseOutlined />} onClick={() => onChangeSelectionMode(false)}>{t("selection.exit")}</Button><Text>{t("selection.count", { count: selectedPaths.length })}</Text></Space>
            <Button type="primary" icon={<CloudSyncOutlined />} disabled={selectedPaths.length === 0} onClick={onOpenBatch}>{t("selection.batch")}</Button>
          </> : <Button icon={<CheckSquareOutlined />} onClick={() => onChangeSelectionMode(true)}>{t("selection.enter")}</Button>}
        </Flex>
      ) : null}

      <div className="track-list-heading" aria-hidden="true">
        <span>#</span><span>{t("table.song")}</span><span>{t("table.album")}</span><span>{t("table.format")}</span><span>{t("table.duration")}</span>
      </div>
      <div className="track-list-rows" aria-busy={loading}>
        {loading && tracks.length === 0
          ? Array.from({ length: 8 }, (_, index) => <div className="track-row track-row-skeleton" key={index} />)
          : tracks.map((track, index) => {
              const selected = selectedPaths.includes(track.path);
              return <div
                className={`track-row${track.path === selectedPath ? " is-current" : ""}${selected ? " is-selected" : ""}`}
                key={track.path}
                role="button"
                tabIndex={0}
                onClick={() => openTrack(track)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openTrack(track); }
                }}
              >
                <div className="track-row-index">{selectionMode ? <Checkbox checked={selected} onClick={(event) => event.stopPropagation()} onChange={() => toggleTrack(track)} /> : <Text type="secondary">{index + 1}</Text>}</div>
                <div className="track-row-primary">
                  <TrackArtwork track={track} size={42} />
                  <div className="track-title-cell">
                    <Text strong ellipsis={{ tooltip: track.title || track.fileName }}>{track.title || track.fileName}</Text>
                    <Text type="secondary" ellipsis={{ tooltip: track.artist }}>{track.artist || t("common.unknownArtist")}</Text>
                  </div>
                </div>
                <Text className="track-row-album" type="secondary" ellipsis={{ tooltip: track.album }}>{track.album || t("common.unknownAlbum")}</Text>
                <div className="track-row-format">{track.format ? <Tag bordered={false}>{track.format}</Tag> : "—"}</div>
                <Text className="track-row-duration" type="secondary">{formatDuration(track.durationSeconds)}</Text>
              </div>;
            })}
      </div>
    </div>
  );
});
