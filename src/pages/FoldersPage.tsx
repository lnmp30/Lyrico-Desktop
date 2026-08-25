import { DeleteOutlined, FolderAddOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Badge, Breadcrumb, Button, Card, Col, Empty, Flex, Input, Row, Segmented, Space, Tag, Tooltip, Tree, Typography } from "antd";
import { memo, useEffect, useMemo, useState, type Key, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AudioTrack, LibraryFolder } from "../app/types";
import { LibraryTable } from "../components/LibraryTable";
import { buildLibraryFolderTree, filterTracks, tracksInDirectory, type LibraryFolderNode } from "../domain/library";

const { DirectoryTree } = Tree;
const { Title, Text } = Typography;

export const FoldersPage = memo(function FoldersPage({
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
  selectedPaths,
  selectionMode,
  onChangeSelectedPaths,
  onChangeSelectionMode,
  onOpenBatch,
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
  selectedPaths: string[];
  selectionMode: boolean;
  onChangeSelectedPaths: (paths: string[]) => void;
  onChangeSelectionMode: (enabled: boolean) => void;
  onOpenBatch: () => void;
}) {
  const { t } = useTranslation();
  const folderTree = useMemo(() => buildLibraryFolderTree(folders, tracks), [folders, tracks]);
  const nodeMap = useMemo(() => mapFolderNodes(folderTree), [folderTree]);
  const selectedRoot = folderTree.find((node) => samePath(node.rootPath, selectedFolderPath)) ?? folderTree[0];
  const [selectedDirectoryKey, setSelectedDirectoryKey] = useState<string>();
  const [expandedKeys, setExpandedKeys] = useState<Key[]>([]);
  const [scope, setScope] = useState<"recursive" | "direct">("recursive");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!selectedRoot) {
      setSelectedDirectoryKey(undefined);
      return;
    }
    const current = selectedDirectoryKey ? nodeMap.get(selectedDirectoryKey) : undefined;
    if (!current || !samePath(current.rootPath, selectedRoot.rootPath)) setSelectedDirectoryKey(selectedRoot.key);
  }, [nodeMap, selectedDirectoryKey, selectedRoot]);

  useEffect(() => {
    const rootKeys = folderTree.map((node) => node.key);
    setExpandedKeys((current) => {
      const missing = rootKeys.filter((key) => !current.includes(key));
      return missing.length ? [...current, ...missing] : current;
    });
  }, [folderTree]);

  const activeNode = (selectedDirectoryKey ? nodeMap.get(selectedDirectoryKey) : undefined) ?? selectedRoot;
  const activeRoot = activeNode ? folders.find((folder) => samePath(folder.path, activeNode.rootPath)) : undefined;
  const folderTracks = useMemo(() => activeNode ? tracksInDirectory(tracks, activeNode.path, scope === "recursive") : [], [activeNode, tracks, scope]);
  const visibleTracks = useMemo(() => filterTracks(folderTracks, query), [folderTracks, query]);
  const breadcrumbs = useMemo(() => activeNode ? folderAncestors(nodeMap, activeNode) : [], [activeNode, nodeMap]);
  const treeData = useMemo(() => folderTree.map((node) => toTreeData(node, folders)), [folderTree, folders]);

  function selectDirectory(node: LibraryFolderNode) {
    setSelectedDirectoryKey(node.key);
    setQuery("");
    const root = folders.find((folder) => samePath(folder.path, node.rootPath));
    if (root && !samePath(root.path, selectedFolderPath)) onSelectFolder(root.path);
  }

  return (
    <div className="workspace page-stack">
      <Flex className="folder-page-header" justify="space-between" align="center" gap={16} wrap>
        <Title level={2}>{t("folders.title")}</Title>
        <Button type="primary" icon={<FolderAddOutlined />} onClick={onAddFolders}>{t("folders.add")}</Button>
      </Flex>

      {folders.length === 0 && !loading ? (
        <Card>
          <Empty className="page-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("folders.empty")}>
            <Button type="primary" icon={<FolderAddOutlined />} onClick={onAddFolders}>{t("folders.add")}</Button>
          </Empty>
        </Card>
      ) : (
        <Row gutter={[16, 16]} align="top" className="folder-browser-row">
          <Col xs={24} lg={6} xl={5} className="folder-browser-column">
            <Card
              className="folder-tree-card"
              loading={loading && folders.length === 0}
              title={t("folders.libraryRoots")}
              extra={<Tag bordered={false}>{folders.length}</Tag>}
              styles={{ body: { padding: 8 } }}
            >
              <DirectoryTree
                blockNode
                showIcon
                treeData={treeData}
                selectedKeys={activeNode ? [activeNode.key] : []}
                expandedKeys={expandedKeys}
                onExpand={(keys) => setExpandedKeys(keys)}
                onSelect={(keys) => {
                  const node = keys[0] ? nodeMap.get(String(keys[0])) : undefined;
                  if (node) selectDirectory(node);
                }}
              />
            </Card>
          </Col>

          <Col xs={24} lg={18} xl={19} className="folder-browser-column">
            {activeNode && activeRoot ? (
              <Card
                className="folder-detail-card"
                title={
                  <Tooltip title={displayFolderPath(activeNode.path, activeRoot.path)}>
                    <Breadcrumb
                      className="folder-detail-breadcrumb"
                      items={breadcrumbs.map((node, index) => ({
                        title: index === breadcrumbs.length - 1 ? node.name : (
                          <Button type="link" size="small" className="folder-breadcrumb-button" onClick={() => selectDirectory(node)}>{node.name}</Button>
                        ),
                      }))}
                    />
                  </Tooltip>
                }
                extra={
                  <Space>
                    <Tooltip title={t("folders.rescan")}>
                      <Button
                        type="text"
                        icon={<ReloadOutlined />}
                        aria-label={t("folders.rescan")}
                        loading={activeRoot.status === "scanning"}
                        disabled={loading || activeRoot.status === "scanning"}
                        onClick={() => onRescanFolder(activeRoot.path)}
                      />
                    </Tooltip>
                    {activeNode.parentKey == null ? (
                      <Tooltip title={t("folders.remove")}>
                        <Button type="text" danger icon={<DeleteOutlined />} aria-label={t("folders.remove")} onClick={() => onRemoveFolder(activeRoot.path)} />
                      </Tooltip>
                    ) : null}
                  </Space>
                }
                styles={{ body: { padding: 0 } }}
              >
                {activeRoot.error ? <Alert className="folder-error-alert" type="error" showIcon message={activeRoot.error} /> : null}

                <Flex className="folder-content-toolbar" align="center" justify="space-between" gap={12} wrap>
                  <Segmented
                    value={scope}
                    options={[
                      { value: "recursive", label: t("folders.includeSubfolders") },
                      { value: "direct", label: t("folders.currentFolderOnly") },
                    ]}
                    onChange={(value) => setScope(value as "recursive" | "direct")}
                  />
                  <Input.Search
                    allowClear
                    className="folder-search"
                    value={query}
                    placeholder={t("folders.searchPlaceholder")}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </Flex>

                <LibraryTable
                  tracks={visibleTracks}
                  loading={loading}
                  selectedPath={selectedTrackPath}
                  onSelectTrack={onSelectTrack}
                  onOpenTrack={(track) => onOpenTrack(track.path)}
                  selectedPaths={selectedPaths}
                  onChangeSelectedPaths={onChangeSelectedPaths}
                  selectionMode={selectionMode}
                  onChangeSelectionMode={onChangeSelectionMode}
                  onOpenBatch={onOpenBatch}
                />
              </Card>
            ) : (
              <Card className="folder-detail-card"><Empty description={t("folders.empty")} /></Card>
            )}
          </Col>
        </Row>
      )}
    </div>
  );
});

function mapFolderNodes(roots: LibraryFolderNode[]) {
  const map = new Map<string, LibraryFolderNode>();
  const visit = (node: LibraryFolderNode) => {
    map.set(node.key, node);
    node.children.forEach(visit);
  };
  roots.forEach(visit);
  return map;
}

function folderAncestors(nodes: Map<string, LibraryFolderNode>, node: LibraryFolderNode) {
  const result: LibraryFolderNode[] = [];
  let current: LibraryFolderNode | undefined = node;
  while (current) {
    result.unshift(current);
    current = current.parentKey ? nodes.get(current.parentKey) : undefined;
  }
  return result;
}

function toTreeData(node: LibraryFolderNode, folders: LibraryFolder[]): { key: string; title: ReactNode; children: ReturnType<typeof toTreeData>[] } {
  const root = folders.find((folder) => samePath(folder.path, node.rootPath));
  return {
    key: node.key,
    title: (
      <Flex className="folder-tree-title" align="center" justify="space-between" gap={8}>
        <Text ellipsis={{ tooltip: displayFolderPath(node.path, root?.path ?? node.rootPath) }}>{node.name}</Text>
        <Space size={6}>
          {node.parentKey == null && root ? <Badge status={root.status === "error" ? "error" : root.status === "scanning" ? "processing" : "success"} /> : null}
          <Text type="secondary">{node.totalTrackCount}</Text>
        </Space>
      </Flex>
    ),
    children: node.children.map((child) => toTreeData(child, folders)),
  };
}

function samePath(left?: string, right?: string) {
  if (!left || !right) return false;
  return left.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase() === right.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
}

function displayFolderPath(path: string, rootPath: string) {
  return rootPath.includes("\\") ? path.replace(/\//g, "\\") : path;
}
