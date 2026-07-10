import {
  Card,
  Checkbox,
  Flex,
  Progress,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  Space,
  type TableColumnsType,
} from "antd";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AudioTrack, BatchCandidate, SourcePlugin } from "../app/types";
import { TrackArtwork } from "../components/TrackArtwork";
import { buildBatchCandidates } from "../domain/library";

const { Title, Text } = Typography;

const batchStatusColor: Record<BatchCandidate["status"], string> = {
  notRun: "default",
  ready: "processing",
  sourceMissing: "warning",
};

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

export function TasksPage({ tracks, plugins }: { tracks: AudioTrack[]; plugins: SourcePlugin[] }) {
  const { t } = useTranslation();
  return (
    <div className="workspace page-stack tasks-view">
      <div>
        <Title level={2}>{t("tasks.title")}</Title>
        <Text type="secondary">{t("tasks.description")}</Text>
      </div>
      <Tabs
        className="tasks-tabs"
        items={[
          {
            key: "metadata",
            label: t("tasks.metadata"),
            children: <MetadataMatchPanel tracks={tracks} plugins={plugins} />,
          },
          {
            key: "replaygain",
            label: t("tasks.replayGain"),
            children: <ReplayGainTagsPanel tracks={tracks} />,
          },
        ]}
      />
    </div>
  );
}

function MetadataMatchPanel({ tracks, plugins }: { tracks: AudioTrack[]; plugins: SourcePlugin[] }) {
  const { t } = useTranslation();
  const sourceNames = plugins.filter((plugin) => plugin.enabled).map((plugin) => plugin.name);
  const [enabledSources, setEnabledSources] = useState<string[]>(sourceNames);
  const candidates = useMemo(() => buildBatchCandidates(tracks, enabledSources), [tracks, enabledSources]);

  const columns: TableColumnsType<BatchCandidate> = [
    {
      title: t("table.track"),
      dataIndex: ["track", "title"],
      render: (_, candidate) => (
        <Space size={12}>
          <TrackArtwork track={candidate.track} size={38} />
          <div className="track-title-cell">
            <Text strong>{candidate.track.title}</Text>
            <Text type="secondary">{candidate.track.artist || t("common.unknownArtist")}</Text>
          </div>
        </Space>
      ),
    },
    {
      title: t("tasks.localMetadata"),
      key: "metadata",
      width: 260,
      render: (_, candidate) => (
        <div className="track-title-cell">
          <Text>{candidate.track.album || t("common.unknownAlbum")}</Text>
          <Text type="secondary">{candidate.track.year || t("tasks.noYear")}</Text>
        </div>
      ),
    },
    {
      title: t("common.sources"),
      dataIndex: "sources",
      width: 220,
      render: (sources: string[]) => sources.map((source) => <Tag key={source}>{source}</Tag>),
    },
    {
      title: t("tasks.queue"),
      dataIndex: "status",
      width: 130,
      render: (value: BatchCandidate["status"]) => <Tag color={batchStatusColor[value]}>{t(`tasks.status.${value}`)}</Tag>,
    },
  ];

  return (
    <>
      <Card size="small">
        <Flex justify="space-between" align="center" gap={16} wrap>
        <Checkbox.Group value={enabledSources} onChange={(values) => setEnabledSources(values.map(String))}>
          <Space wrap>
            {sourceNames.map((source) => (
              <Checkbox key={source} value={source}>
                {source}
              </Checkbox>
            ))}
          </Space>
        </Checkbox.Group>
        <Text type="secondary">{t("tasks.preview", { count: candidates.length })}</Text>
        </Flex>
      </Card>
      <Progress percent={0} />
      <Card styles={{ body: { padding: 0 } }}>
        <Table
          rowKey={(candidate) => candidate.track.path}
          columns={columns}
          dataSource={candidates}
          size="middle"
          pagination={{ defaultPageSize: 20, showSizeChanger: true, showTotal: (total) => t("common.trackCount", { count: total }) }}
          scroll={{ x: 820 }}
        />
      </Card>
    </>
  );
}

function ReplayGainTagsPanel({ tracks }: { tracks: AudioTrack[] }) {
  const { t } = useTranslation();
  const rows: GainRow[] = tracks.map((track) => {
    const hasReplayGain = Boolean(
      track.replayGainTrackGain ||
        track.replayGainTrackPeak ||
        track.replayGainAlbumGain ||
        track.replayGainAlbumPeak,
    );
    return {
      path: track.path,
      title: track.title,
      album: track.album || t("common.unknownAlbum"),
      trackGain: track.replayGainTrackGain || "-",
      trackPeak: track.replayGainTrackPeak || "-",
      albumGain: track.replayGainAlbumGain || "-",
      albumPeak: track.replayGainAlbumPeak || "-",
      status: hasReplayGain ? "present" : "missing",
    };
  });
  const taggedCount = rows.filter((row) => row.status === "present").length;

  const columns: TableColumnsType<GainRow> = [
    { title: t("details.titleField"), dataIndex: "title" },
    { title: t("table.album"), dataIndex: "album" },
    { title: t("tasks.trackGain"), dataIndex: "trackGain", width: 130, align: "right" },
    { title: t("tasks.trackPeak"), dataIndex: "trackPeak", width: 130, align: "right" },
    { title: t("tasks.albumGain"), dataIndex: "albumGain", width: 130, align: "right" },
    { title: t("tasks.albumPeak"), dataIndex: "albumPeak", width: 130, align: "right" },
    {
      title: t("tasks.tag"),
      dataIndex: "status",
      width: 110,
      render: (status: GainRow["status"]) => (
        <Tag color={status === "present" ? "success" : "default"}>{t(`tasks.status.${status}`)}</Tag>
      ),
    },
  ];

  return (
    <>
      <Card>
        <Flex className="metric-strip" gap={36} align="center" wrap>
        <Statistic title={t("common.songs")} value={rows.length} />
        <Statistic title={t("tasks.replayTags")} value={taggedCount} />
        <Statistic title={t("tasks.missing")} value={rows.length - taggedCount} />
        <Progress type="circle" percent={rows.length ? Math.round((taggedCount / rows.length) * 100) : 0} size={76} />
        </Flex>
      </Card>
      <Card styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="path"
          columns={columns}
          dataSource={rows}
          size="middle"
          pagination={{ defaultPageSize: 20, showSizeChanger: true, showTotal: (total) => t("common.trackCount", { count: total }) }}
          scroll={{ x: 920 }}
        />
      </Card>
    </>
  );
}
