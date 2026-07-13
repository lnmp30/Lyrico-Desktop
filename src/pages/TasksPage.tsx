import {
  CalculatorOutlined,
  EditOutlined,
  ExportOutlined,
  FileTextOutlined,
  FormOutlined,
  TagsOutlined,
} from "@ant-design/icons";
import { Button, Checkbox, Progress, Space, Table, Tag, Tooltip, Typography, type TableColumnsType } from "antd";
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AudioTrack, BatchTask, SourcePlugin } from "../app/types";
import { TrackArtwork } from "../components/TrackArtwork";

const { Title, Text } = Typography;

type GainRow = {
  path: string;
  title: string;
  album: string;
  trackGain: string;
  trackPeak: string;
  albumGain: string;
  albumPeak: string;
  status: "present" | "missing";
};

type BatchOperation = "metadata" | "edit" | "rename" | "lyrics" | "exportLyrics" | "exportCover" | "replaygain";

const availableOperations = new Set<BatchOperation>(["replaygain"]);

const operationIcons: Record<BatchOperation, ReactNode> = {
  metadata: <TagsOutlined />,
  edit: <EditOutlined />,
  rename: <FormOutlined />,
  lyrics: <FileTextOutlined />,
  exportLyrics: <ExportOutlined />,
  exportCover: <ExportOutlined />,
  replaygain: <CalculatorOutlined />,
};

export function TasksPage({ tracks, plugins, selectedPaths, activeTask, onRunReplayGain, onCancelReplayGain }: { tracks: AudioTrack[]; plugins: SourcePlugin[]; selectedPaths: string[]; activeTask?: BatchTask; onRunReplayGain: () => void; onCancelReplayGain: () => void }) {
  const { t } = useTranslation();
  const [operation, setOperation] = useState<BatchOperation>("replaygain");
  const selectedSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);
  const selectedTracks = useMemo(() => tracks.filter((track) => selectedSet.has(track.path)), [selectedSet, tracks]);
  const operations = ["metadata", "edit", "rename", "lyrics", "exportLyrics", "exportCover", "replaygain"] as BatchOperation[];

  return (
    <div className="workspace page-stack tasks-view">
      <header className="batch-page-header">
        <Title level={2}>{t("tasks.title")}</Title>
        <Text strong>{t("selection.count", { count: selectedTracks.length })}</Text>
      </header>

      <div className="batch-action-bar" role="toolbar" aria-label={t("tasks.chooseOperation")}>
        {operations.map((key) => {
          const available = availableOperations.has(key);
          const button = (
            <Button
              key={key}
              type={operation === key ? "primary" : "text"}
              icon={operationIcons[key]}
              disabled={!available}
              onClick={() => setOperation(key)}
            >
              {t(`tasks.operations.${key}`)}
            </Button>
          );
          return available ? button : <Tooltip key={key} title={t("tasks.unavailable")}>{button}</Tooltip>;
        })}
      </div>

      {operation === "metadata" ? (
        <MetadataMatchPanel tracks={selectedTracks} plugins={plugins} />
      ) : (
        <ReplayGainTagsPanel
          tracks={selectedTracks}
          task={activeTask}
          onRun={onRunReplayGain}
          onCancel={onCancelReplayGain}
        />
      )}
    </div>
  );
}

function MetadataMatchPanel({ tracks, plugins }: { tracks: AudioTrack[]; plugins: SourcePlugin[] }) {
  const { t } = useTranslation();
  const sourceNames = plugins.filter((plugin) => plugin.enabled).map((plugin) => plugin.name);
  const [enabledSources, setEnabledSources] = useState<string[]>(sourceNames);

  const columns: TableColumnsType<AudioTrack> = [
    {
      title: t("table.track"),
      dataIndex: "title",
      render: (_, track) => (
        <Space size={12}>
          <TrackArtwork track={track} size={38} />
          <div className="track-title-cell">
            <Text strong>{track.title || track.fileName}</Text>
            <Text type="secondary">{track.artist || t("common.unknownArtist")}</Text>
          </div>
        </Space>
      ),
    },
    {
      title: t("table.album"),
      dataIndex: "album",
      width: 260,
      render: (album: string) => album || t("common.unknownAlbum"),
    },
    {
      title: t("details.year"),
      dataIndex: "year",
      width: 100,
      render: (year: string) => year || "-",
    },
  ];

  return (
    <section className="batch-panel">
      <div className="batch-panel-toolbar">
        <Checkbox.Group value={enabledSources} onChange={(values) => setEnabledSources(values.map(String))}>
          <Space wrap>
            {sourceNames.map((source) => (
              <Checkbox key={source} value={source}>{source}</Checkbox>
            ))}
          </Space>
        </Checkbox.Group>
        {sourceNames.length === 0 && <Text type="secondary">{t("tasks.noSources")}</Text>}
      </div>
      <Table
        className="batch-table"
        rowKey="path"
        columns={columns}
        dataSource={tracks}
        size="middle"
        pagination={false}
        scroll={{ x: 720 }}
      />
    </section>
  );
}

function ReplayGainTagsPanel({ tracks, task, onRun, onCancel }: { tracks: AudioTrack[]; task?: BatchTask; onRun: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const rows: GainRow[] = useMemo(() => tracks.map((track) => {
    const hasReplayGain = Boolean(
      track.replayGainTrackGain || track.replayGainTrackPeak || track.replayGainAlbumGain || track.replayGainAlbumPeak,
    );
    return {
      path: track.path,
      title: track.title || track.fileName,
      album: track.album || t("common.unknownAlbum"),
      trackGain: track.replayGainTrackGain || "-",
      trackPeak: track.replayGainTrackPeak || "-",
      albumGain: track.replayGainAlbumGain || "-",
      albumPeak: track.replayGainAlbumPeak || "-",
      status: hasReplayGain ? "present" : "missing",
    };
  }), [t, tracks]);

  const columns: TableColumnsType<GainRow> = useMemo(() => [
    { title: t("details.titleField"), dataIndex: "title" },
    { title: t("table.album"), dataIndex: "album" },
    { title: t("tasks.trackGain"), dataIndex: "trackGain", width: 130, align: "right" },
    { title: t("tasks.trackPeak"), dataIndex: "trackPeak", width: 130, align: "right" },
    { title: t("tasks.albumGain"), dataIndex: "albumGain", width: 130, align: "right" },
    { title: t("tasks.albumPeak"), dataIndex: "albumPeak", width: 130, align: "right" },
    {
      title: t("common.status"),
      dataIndex: "status",
      width: 100,
      render: (status: GainRow["status"]) => (
        <Tag color={status === "present" ? "success" : "default"}>{t(`tasks.status.${status}`)}</Tag>
      ),
    },
  ], [t]);

  return (
    <section className="batch-panel">
      <Table
        className="batch-table"
        rowKey="path"
        columns={columns}
        dataSource={rows}
        size="middle"
        pagination={false}
        scroll={{ x: 920 }}
      />
      <footer className="batch-panel-footer">
        {task && (
          <div className="batch-task-progress">
            <Progress percent={task.total ? Math.round((task.current / task.total) * 100) : 0} showInfo={false} size="small" status={task.status === "failed" ? "exception" : task.status === "succeeded" ? "success" : "active"} />
            <Text type="secondary">
              {t("tasks.taskSummary", { current: task.current, total: task.total, success: task.successCount, skipped: task.skippedCount, failed: task.failureCount })}
            </Text>
          </div>
        )}
        {task?.status === "running" ? (
          <Button danger onClick={onCancel}>{t("common.cancel")}</Button>
        ) : (
          <Button type="primary" icon={<CalculatorOutlined />} disabled={tracks.length === 0} onClick={onRun}>{t("tasks.startReplayGain")}</Button>
        )}
      </footer>
    </section>
  );
}
