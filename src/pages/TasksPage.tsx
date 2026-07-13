import {
  CalculatorOutlined,
  EditOutlined,
  ExportOutlined,
  FileTextOutlined,
  FormOutlined,
  TagsOutlined,
} from "@ant-design/icons";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { App, Button, Checkbox, Modal, Progress, Select, Space, Table, Tag, Tooltip, Typography, type TableColumnsType } from "antd";
import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import type { AudioTrack, BatchTask, DesktopSettings, SourcePlugin } from "../app/types";
import { cancelBatchTask, createBatchTask, loadBatchTasks, startBatchTask } from "../backend/audioApi";
import { TrackArtwork } from "../components/TrackArtwork";
import { LYRIC_FORMATS, type LyricFormat } from "../domain/pluginLyrics";

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

type LyricsFormatConfig = {
  targetFormat?: LyricFormat;
  formatLineOrder: boolean;
  removeTagLines: boolean;
  removeEmptyLines: boolean;
};

type MetadataWriteMode = "disabled" | "supplement" | "overwrite";
type MetadataMatchConfig = {
  targetModes: Record<string, MetadataWriteMode>;
  enabledSourceOrderIds: string[];
  preferFileName: boolean;
  concurrency: number;
};

const metadataTargets = [
  ["title", "details.titleField"], ["artist", "details.artist"], ["album", "details.album"],
  ["album_artist", "details.albumArtist"], ["genre", "details.genre"], ["date", "details.year"],
  ["track_number", "details.track"], ["disc_number", "details.disc"], ["composer", "details.composer"],
  ["lyricist", "details.lyricist"], ["comment", "details.comment"], ["lyrics", "details.lyrics"],
  ["cover_url", "details.cover"], ["language", "details.language"], ["copyright", "details.copyright"],
  ["rating", "details.rating"], ["replaygain_track_gain", "tasks.trackGain"],
  ["replaygain_track_peak", "tasks.trackPeak"], ["replaygain_album_gain", "tasks.albumGain"],
  ["replaygain_album_peak", "tasks.albumPeak"],
] as const;

const defaultMetadataTargets = new Set(["title", "artist", "album", "genre", "date", "track_number", "lyrics", "cover_url"]);
const defaultMetadataModes: Record<string, MetadataWriteMode> = Object.fromEntries(
  metadataTargets.map(([key]) => [key, defaultMetadataTargets.has(key) ? "supplement" : "disabled"]),
);

const defaultTagLineKeywords = [
  "[by:", "[kana:", "[trans:", "[roma:",
  "作词：", "作词:", "作曲：", "作曲:", "编曲：", "编曲:",
  "制作人：", "制作人:", "监制：", "监制:", "混音：", "混音:",
  "录音：", "录音:", "母带：", "母带:", "和声：", "和声:",
  "配唱制作人：", "配唱制作人:", "OP：", "OP:", "SP：", "SP:",
  "出品：", "出品:", "发行：", "发行:",
];

const availableOperations = new Set<BatchOperation>(["metadata", "lyrics", "replaygain"]);

const operationIcons: Record<BatchOperation, ReactNode> = {
  metadata: <TagsOutlined />,
  edit: <EditOutlined />,
  rename: <FormOutlined />,
  lyrics: <FileTextOutlined />,
  exportLyrics: <ExportOutlined />,
  exportCover: <ExportOutlined />,
  replaygain: <CalculatorOutlined />,
};

export function TasksPage({ tracks, plugins, selectedPaths, settings, artistSeparator }: { tracks: AudioTrack[]; plugins: SourcePlugin[]; selectedPaths: string[]; settings: DesktopSettings; artistSeparator: string }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [operation, setOperation] = useState<BatchOperation>("replaygain");
  const [activeReplayGainTask, setActiveReplayGainTask] = useState<BatchTask>();
  const [activeLyricsTask, setActiveLyricsTask] = useState<BatchTask>();
  const [activeMetadataTask, setActiveMetadataTask] = useState<BatchTask>();
  const [submitting, setSubmitting] = useState(false);
  const selectedSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);
  const selectedTracks = useMemo(() => tracks.filter((track) => selectedSet.has(track.path)), [selectedSet, tracks]);
  const operations = ["metadata", "edit", "rename", "lyrics", "exportLyrics", "exportCover", "replaygain"] as BatchOperation[];
  const replayGainIsActive = isActiveTask(activeReplayGainTask);
  const lyricsIsActive = isActiveTask(activeLyricsTask);
  const metadataIsActive = isActiveTask(activeMetadataTask);

  useEffect(() => {
    let disposed = false;
    void loadBatchTasks()
      .then((tasks) => {
        if (disposed) return;
        const replayGainTasks = tasks.filter((task) => task.taskType === "replayGain");
        const lyricsTasks = tasks.filter((task) => task.taskType === "formatLyrics");
        const metadataTasks = tasks.filter((task) => task.taskType === "matchMetadata");
        setActiveReplayGainTask(currentOrLatestTask(replayGainTasks));
        setActiveLyricsTask(currentOrLatestTask(lyricsTasks));
        setActiveMetadataTask(currentOrLatestTask(metadataTasks));
      })
      .catch((error) => message.error(String(error)));
    return () => {
      disposed = true;
    };
  }, [message]);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    void listen<BatchTask>("batch-task-updated", ({ payload }) => {
      if (disposed) return;
      const updateTask = (setTask: Dispatch<SetStateAction<BatchTask | undefined>>) => {
        setTask((current) => {
          if (!current || current.taskId === payload.taskId || payload.status === "queued" || payload.status === "running") {
            return payload;
          }
          return current;
        });
      };
      if (payload.taskType === "replayGain") {
        updateTask(setActiveReplayGainTask);
      } else if (payload.taskType === "formatLyrics") {
        updateTask(setActiveLyricsTask);
      } else if (payload.taskType === "matchMetadata") {
        updateTask(setActiveMetadataTask);
      }
    }).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  async function runReplayGain() {
    if (selectedTracks.length === 0 || replayGainIsActive) return;
    setSubmitting(true);
    try {
      const created = await createBatchTask(
        "replayGain",
        selectedTracks.map((track) => track.path),
        JSON.stringify({ concurrency: 3, mode: "track" }),
      );
      const started = await startBatchTask(created.taskId);
      setActiveReplayGainTask(started);
    } catch (error) {
      message.error(String(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelReplayGain() {
    if (!activeReplayGainTask || !replayGainIsActive) return;
    try {
      const cancelled = await cancelBatchTask(activeReplayGainTask.taskId);
      setActiveReplayGainTask(cancelled);
      message.info(t("tasks.batchCancelled"));
    } catch (error) {
      message.error(String(error));
    }
  }

  async function runLyricsFormat(config: LyricsFormatConfig) {
    if (selectedTracks.length === 0 || lyricsIsActive) return;
    setSubmitting(true);
    try {
      const created = await createBatchTask(
        "formatLyrics",
        selectedTracks.map((track) => track.path),
        JSON.stringify({
          ...config,
          targetFormat: config.targetFormat ?? null,
          tagLineKeywords: defaultTagLineKeywords,
          concurrency: 3,
        }),
      );
      const started = await startBatchTask(created.taskId);
      setActiveLyricsTask(started);
    } catch (error) {
      message.error(String(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelLyricsFormat() {
    if (!activeLyricsTask || !lyricsIsActive) return;
    try {
      const cancelled = await cancelBatchTask(activeLyricsTask.taskId);
      setActiveLyricsTask(cancelled);
      message.info(t("tasks.batchCancelled"));
    } catch (error) {
      message.error(String(error));
    }
  }

  async function runMetadataMatch(config: MetadataMatchConfig) {
    if (selectedTracks.length === 0 || metadataIsActive) return;
    setSubmitting(true);
    try {
      const created = await createBatchTask(
        "matchMetadata",
        selectedTracks.map((track) => track.path),
        JSON.stringify({
          ...config,
          separator: artistSeparator,
          lyricFormat: settings.lyricFormat,
          showTranslation: settings.showTranslation,
          showRomanization: settings.showRomanization,
          onlyTranslationIfAvailable: settings.onlyTranslationIfAvailable,
          removeEmptyLyricLines: settings.removeEmptyLyricLines,
          lyricsConversionMode: settings.lyricsConversionMode,
        }),
      );
      setActiveMetadataTask(await startBatchTask(created.taskId));
    } catch (error) {
      message.error(String(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelMetadataMatch() {
    if (!activeMetadataTask || !metadataIsActive) return;
    try {
      setActiveMetadataTask(await cancelBatchTask(activeMetadataTask.taskId));
      message.info(t("tasks.batchCancelled"));
    } catch (error) {
      message.error(String(error));
    }
  }

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
        <MetadataMatchPanel
          tracks={selectedTracks}
          plugins={plugins}
          task={activeMetadataTask}
          submitting={submitting}
          onRun={runMetadataMatch}
          onCancel={cancelMetadataMatch}
        />
      ) : operation === "lyrics" ? (
        <LyricsFormatPanel
          tracks={selectedTracks}
          task={activeLyricsTask}
          submitting={submitting}
          onRun={runLyricsFormat}
          onCancel={cancelLyricsFormat}
        />
      ) : (
        <ReplayGainTagsPanel
          tracks={selectedTracks}
          task={activeReplayGainTask}
          submitting={submitting}
          onRun={runReplayGain}
          onCancel={cancelReplayGain}
        />
      )}
    </div>
  );
}

function currentOrLatestTask(tasks: BatchTask[]) {
  return tasks.find(isActiveTask) ?? tasks[0];
}

function isActiveTask(task?: BatchTask) {
  return task?.status === "queued" || task?.status === "running";
}

function MetadataMatchPanel({ tracks, plugins, task, submitting, onRun, onCancel }: { tracks: AudioTrack[]; plugins: SourcePlugin[]; task?: BatchTask; submitting: boolean; onRun: (config: MetadataMatchConfig) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const availableSources = useMemo(() => plugins.filter((plugin) => plugin.enabled && plugin.capabilities.includes("searchSongs")), [plugins]);
  const [enabledSources, setEnabledSources] = useState<string[]>(availableSources.map((plugin) => plugin.id));
  const [targetModes, setTargetModes] = useState<Record<string, MetadataWriteMode>>(defaultMetadataModes);
  const [preferFileName, setPreferFileName] = useState(false);
  const [concurrency, setConcurrency] = useState(3);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const sourceIds = availableSources.map((plugin) => plugin.id);
    setEnabledSources((current) => {
      const retained = current.filter((id) => sourceIds.includes(id));
      return retained.length > 0 || sourceIds.length === 0 ? retained : sourceIds;
    });
  }, [availableSources]);

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
            {availableSources.map((source) => (
              <Checkbox key={source.id} value={source.id}>{source.name}</Checkbox>
            ))}
          </Space>
        </Checkbox.Group>
        {availableSources.length === 0 && <Text type="secondary">{t("tasks.noSources")}</Text>}
        <Space wrap>
          <Checkbox checked={preferFileName} onChange={(event) => {
            const checked = event.target.checked;
            setPreferFileName(checked);
            if (checked) setTargetModes((current) => ({ ...current, title: current.title === "disabled" ? "disabled" : "overwrite", artist: current.artist === "disabled" ? "disabled" : "overwrite" }));
          }}>{t("tasks.preferFileName")}</Checkbox>
          <Select value={concurrency} onChange={setConcurrency} style={{ width: 130 }} options={[1, 2, 3, 4, 5].map((value) => ({ value, label: t("tasks.concurrency", { count: value }) }))} />
          <Button onClick={() => setSettingsOpen(true)}>{t("tasks.matchFields")}</Button>
        </Space>
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
      <footer className="batch-panel-footer">
        {task && <BatchTaskProgress task={task} />}
        {isActiveTask(task) ? (
          <Button danger onClick={onCancel}>{t("common.cancel")}</Button>
        ) : (
          <Button
            type="primary"
            icon={<TagsOutlined />}
            loading={submitting}
            disabled={tracks.length === 0 || enabledSources.length === 0 || Object.values(targetModes).every((mode) => mode === "disabled")}
            onClick={() => onRun({ targetModes, enabledSourceOrderIds: enabledSources, preferFileName, concurrency })}
          >
            {t("tasks.startMetadataMatch")}
          </Button>
        )}
      </footer>
      <Modal title={t("tasks.matchFields")} open={settingsOpen} onCancel={() => setSettingsOpen(false)} onOk={() => setSettingsOpen(false)} destroyOnHidden>
        <Table
          rowKey="key"
          size="small"
          pagination={false}
          scroll={{ y: 420 }}
          dataSource={metadataTargets.map(([key, label]) => ({ key, label: t(label) }))}
          columns={[
            { title: t("tasks.tag"), dataIndex: "label" },
            {
              title: t("tasks.writeMode"),
              width: 180,
              render: (_, row: { key: string }) => (
                <Select
                  value={targetModes[row.key] ?? "disabled"}
                  style={{ width: "100%" }}
                  onChange={(mode) => setTargetModes((current) => ({ ...current, [row.key]: mode }))}
                  options={[
                    { value: "disabled", label: t("common.disabled") },
                    { value: "supplement", label: t("details.supplement") },
                    { value: "overwrite", label: t("details.overwrite") },
                  ]}
                />
              ),
            },
          ]}
        />
      </Modal>
    </section>
  );
}

function LyricsFormatPanel({ tracks, task, submitting, onRun, onCancel }: { tracks: AudioTrack[]; task?: BatchTask; submitting: boolean; onRun: (config: LyricsFormatConfig) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [targetFormat, setTargetFormat] = useState<LyricFormat>();
  const [formatLineOrder, setFormatLineOrder] = useState(true);
  const [removeTagLines, setRemoveTagLines] = useState(false);
  const [removeEmptyLines, setRemoveEmptyLines] = useState(false);
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
    { title: t("table.album"), dataIndex: "album", width: 260, render: (album: string) => album || t("common.unknownAlbum") },
    {
      title: t("common.status"),
      width: 120,
      render: (_, track) => <Tag color={track.hasLyrics ? "success" : "default"}>{t(track.hasLyrics ? "tasks.lyricsPresent" : "tasks.lyricsMissing")}</Tag>,
    },
  ];
  const hasOperation = Boolean(targetFormat || formatLineOrder || removeTagLines || removeEmptyLines);

  return (
    <section className="batch-panel">
      <div className="batch-panel-toolbar">
        <Space wrap>
          <Select
            value={targetFormat ?? "keep"}
            style={{ width: 150 }}
            onChange={(value) => setTargetFormat(value === "keep" ? undefined : value as LyricFormat)}
            options={[
              { value: "keep", label: t("tasks.keepLyricsFormat") },
              ...LYRIC_FORMATS.map((format) => ({ value: format, label: t(`lyrics.formats.${format}`) })),
            ]}
          />
          <Checkbox checked={formatLineOrder} onChange={(event) => setFormatLineOrder(event.target.checked)}>{t("tasks.formatLineOrder")}</Checkbox>
          <Checkbox checked={removeTagLines} onChange={(event) => setRemoveTagLines(event.target.checked)}>{t("tasks.removeTagLines")}</Checkbox>
          <Checkbox checked={removeEmptyLines} onChange={(event) => setRemoveEmptyLines(event.target.checked)}>{t("lyrics.removeEmpty")}</Checkbox>
        </Space>
      </div>
      <Table className="batch-table" rowKey="path" columns={columns} dataSource={tracks} size="middle" pagination={false} scroll={{ x: 720 }} />
      <footer className="batch-panel-footer">
        {task && <BatchTaskProgress task={task} />}
        {isActiveTask(task) ? (
          <Button danger onClick={onCancel}>{t("common.cancel")}</Button>
        ) : (
          <Button
            type="primary"
            icon={<FileTextOutlined />}
            loading={submitting}
            disabled={tracks.length === 0 || !hasOperation}
            onClick={() => onRun({ targetFormat, formatLineOrder, removeTagLines, removeEmptyLines })}
          >
            {t("tasks.startLyricsFormat")}
          </Button>
        )}
      </footer>
    </section>
  );
}

function ReplayGainTagsPanel({ tracks, task, submitting, onRun, onCancel }: { tracks: AudioTrack[]; task?: BatchTask; submitting: boolean; onRun: () => void; onCancel: () => void }) {
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

  const taskIsActive = task?.status === "queued" || task?.status === "running";

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
        {task && <BatchTaskProgress task={task} />}
        {taskIsActive ? (
          <Button danger onClick={onCancel}>{t("common.cancel")}</Button>
        ) : (
          <Button type="primary" icon={<CalculatorOutlined />} loading={submitting} disabled={tracks.length === 0} onClick={onRun}>{t("tasks.startReplayGain")}</Button>
        )}
      </footer>
    </section>
  );
}

function BatchTaskProgress({ task }: { task: BatchTask }) {
  const { t } = useTranslation();
  return (
    <div className="batch-task-progress">
      <Progress percent={task.total ? Math.round((task.current / task.total) * 100) : 0} showInfo={false} size="small" status={task.status === "failed" ? "exception" : task.status === "succeeded" ? "success" : "active"} />
      <Text type="secondary">
        {t("tasks.taskSummary", { current: task.current, total: task.total, success: task.successCount, skipped: task.skippedCount, failed: task.failureCount })}
      </Text>
    </div>
  );
}
