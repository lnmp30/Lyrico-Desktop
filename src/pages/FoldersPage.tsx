import { DeleteOutlined, FolderAddOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Card, Empty, Flex, Space, Table, Tag, Tooltip, Typography, type TableColumnsType } from "antd";
import { useTranslation } from "react-i18next";
import type { AudioTrack, LibraryFolder } from "../app/types";
import { LibraryTable } from "../components/LibraryTable";
import { tracksInFolder } from "../domain/library";
import { formatDateTime, shortPath } from "../utils/format";

const { Title, Text } = Typography;

export function FoldersPage({
  folders,
  tracks,
  selectedFolderPath,
  selectedTrackPath,
  loading,
  onAddFolders,
  onRescanFolder,
  onRemoveFolder,
  onSelectFolder,
  onSelectTrack,
  onOpenTrack,
}: {
  folders: LibraryFolder[];
  tracks: AudioTrack[];
  selectedFolderPath?: string;
  selectedTrackPath?: string;
  loading: boolean;
  onAddFolders: () => void;
  onRescanFolder: (path: string) => void;
  onRemoveFolder: (path: string) => void;
  onSelectFolder: (path?: string) => void;
  onSelectTrack: (path?: string) => void;
  onOpenTrack: (path: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const selectedFolder = folders.find((folder) => folder.path === selectedFolderPath) ?? folders[0];
  const folderTracks = selectedFolder ? tracksInFolder(tracks, selectedFolder) : [];
  const columns: TableColumnsType<LibraryFolder> = [
    {
      title: t("folders.folder"),
      dataIndex: "path",
      render: (path: string) => (
        <div className="track-title-cell">
          <Text strong>{shortPath(path)}</Text>
          <Text type="secondary" ellipsis={{ tooltip: path }}>{path}</Text>
        </div>
      ),
    },
    { title: t("common.songs"), dataIndex: "trackCount", width: 90, align: "right" },
    {
      title: t("common.status"),
      dataIndex: "status",
      width: 110,
      render: (value: LibraryFolder["status"]) => (
        <Tag color={value === "error" ? "error" : value === "scanning" ? "processing" : "success"}>{t(`folders.status.${value}`)}</Tag>
      ),
    },
    { title: t("folders.lastScan"), dataIndex: "lastScannedAt", width: 170, responsive: ["lg"], render: (value?: string) => formatDateTime(value, i18n.resolvedLanguage) },
    {
      title: t("common.actions"),
      key: "actions",
      width: 100,
      align: "right",
      render: (_, folder) => (
        <Space size={4}>
          <Tooltip title={t("folders.rescan")}>
            <Button
              type="text"
              aria-label={t("folders.rescan")}
              icon={<ReloadOutlined />}
              disabled={loading || folder.status === "scanning"}
              loading={folder.status === "scanning"}
              onClick={(event) => {
                event.stopPropagation();
                onRescanFolder(folder.path);
              }}
            />
          </Tooltip>
          <Tooltip title={t("folders.remove")}>
            <Button
              type="text"
              danger
              aria-label={t("folders.remove")}
              icon={<DeleteOutlined />}
              onClick={(event) => {
                event.stopPropagation();
                onRemoveFolder(folder.path);
              }}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div className="workspace page-stack">
      <Flex justify="space-between" align="start" gap={16} wrap>
        <div>
          <Title level={2}>{t("folders.title")}</Title>
          <Text type="secondary">{t("folders.description")}</Text>
        </div>
        <Button type="primary" icon={<FolderAddOutlined />} onClick={onAddFolders}>{t("folders.add")}</Button>
      </Flex>

      <Card
        className="content-card"
        title={t("common.folders")}
        extra={<Text type="secondary">{t("folders.configured", { count: folders.length })}</Text>}
        styles={{ body: { padding: 0 } }}
      >
        {folders.length === 0 && !loading ? (
          <Empty className="page-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("folders.empty")} />
        ) : (
          <Table
            rowKey="path"
            loading={loading}
            columns={columns}
            dataSource={folders}
            size="middle"
            tableLayout="fixed"
            pagination={false}
            scroll={{ x: 620 }}
            rowClassName={(folder) => (folder.path === selectedFolder?.path ? "row-focused" : "")}
            onRow={(folder) => ({ onClick: () => onSelectFolder(folder.path) })}
          />
        )}
      </Card>

      {selectedFolder && (
        <Card
          className="content-card"
          title={shortPath(selectedFolder.path)}
          extra={<Text type="secondary">{t("common.songCount", { count: folderTracks.length })}</Text>}
          styles={{ body: { padding: 0 } }}
        >
          <LibraryTable
            tracks={folderTracks}
            selectedPath={selectedTrackPath}
            onSelectTrack={onSelectTrack}
            onOpenTrack={(track) => onOpenTrack(track.path)}
            pageSize={10}
            selectable={false}
          />
        </Card>
      )}
    </div>
  );
}
