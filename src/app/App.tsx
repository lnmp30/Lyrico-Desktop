import { open } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { App as AntApp, ConfigProvider, Form, theme } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  loadLibraryFolders,
  loadArtistSplitConfig,
  loadLibraryTrack,
  loadLibraryTracks,
  readAudioFile,
  removeLibraryFolder,
  saveAudioTags,
  saveArtistSplitConfig,
  scanFolder,
  upsertLibraryFolder,
} from "../backend/audioApi";
import { Shell } from "../components/Shell";
import { SongDetails } from "../components/SongDetails";
import { initialPlugins } from "../data/pluginCatalog";
import { defaultArtistSplitConfig, filterTracks, groupAlbums, groupArtists } from "../domain/library";
import { updateCachedCover } from "../hooks/useTrackCovers";
import {
  getLanguagePreference,
  resolveLanguage,
  setLanguagePreference as persistLanguagePreference,
  type LanguagePreference,
} from "../i18n";
import { AlbumsPage } from "../pages/AlbumsPage";
import { ArtistsPage } from "../pages/ArtistsPage";
import { FoldersPage } from "../pages/FoldersPage";
import { PluginsPage } from "../pages/PluginsPage";
import { SettingsPage } from "../pages/SettingsPage";
import { SongsPage } from "../pages/SongsPage";
import { TasksPage } from "../pages/TasksPage";
import type { ArtistSplitConfig, AudioTrack, LibraryFolder, ScanProgress, SourcePlugin, TagForm, ViewKey } from "./types";
import "../App.css";

export default function App() {
  const { i18n } = useTranslation();
  const antLocale = i18n.resolvedLanguage?.startsWith("zh") ? zhCN : enUS;

  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? "en-US";
  }, [i18n.resolvedLanguage]);

  return (
    <ConfigProvider
      locale={antLocale}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: "#1677ff",
          borderRadius: 8,
          fontFamily:
            "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
        },
      }}
    >
      <AntApp>
        <LyricoDesktop />
      </AntApp>
    </ConfigProvider>
  );
}

function LyricoDesktop() {
  const { message } = AntApp.useApp();
  const { t, i18n } = useTranslation();
  const [activeView, setActiveView] = useState<ViewKey>("songs");
  const [tracks, setTracks] = useState<AudioTrack[]>([]);
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>();
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [selectedFolderPath, setSelectedFolderPath] = useState<string>();
  const [selectedAlbumId, setSelectedAlbumId] = useState<string>();
  const [selectedArtistId, setSelectedArtistId] = useState<string>();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailTrack, setDetailTrack] = useState<AudioTrack>();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [albumDetailsOpen, setAlbumDetailsOpen] = useState(false);
  const [artistDetailsOpen, setArtistDetailsOpen] = useState(false);
  const [plugins, setPlugins] = useState<SourcePlugin[]>(initialPlugins);
  const [artistSplitConfig, setArtistSplitConfig] = useState<ArtistSplitConfig>(defaultArtistSplitConfig);
  const [languagePreference, setLanguagePreference] = useState<LanguagePreference>(getLanguagePreference);
  const [scanProgress, setScanProgress] = useState<ScanProgress>();
  const [form] = Form.useForm<TagForm>();
  const detailRequest = useRef(0);
  const artistSplitSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const deferredQuery = useDeferredValue(query);
  const isSearchView = activeView === "songs" || activeView === "albums" || activeView === "artists";
  const filteredTracks = useMemo(
    () => (isSearchView ? filterTracks(tracks, deferredQuery) : tracks),
    [tracks, deferredQuery, isSearchView],
  );
  const albums = useMemo(() => (activeView === "albums" ? groupAlbums(filteredTracks) : []), [activeView, filteredTracks]);
  const artists = useMemo(
    () => (activeView === "artists" ? groupArtists(filteredTracks, artistSplitConfig) : []),
    [activeView, filteredTracks, artistSplitConfig],
  );
  const selectedTrackSummary = tracks.find((track) => track.path === selectedPath);
  const selectedTrack = detailTrack?.path === selectedPath ? detailTrack : selectedTrackSummary;

  useEffect(() => {
    Promise.all([loadLibraryFolders(), loadLibraryTracks(), loadArtistSplitConfig()])
      .then(([storedFolders, storedTracks, storedArtistSplitConfig]) => {
        setFolders(storedFolders);
        setTracks(storedTracks);
        setSelectedFolderPath(storedFolders[0]?.path);
        setSelectedPath(storedTracks[0]?.path);
        setSelectedPaths([]);
        setArtistSplitConfig(storedArtistSplitConfig);
      })
      .catch(() => {
        setFolders([]);
        setTracks([]);
      });
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    void listen<ScanProgress>("library-scan-progress", ({ payload }) => {
      setScanProgress(payload);
    }).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!scanProgress || scanProgress.status === "running") return;
    const timeout = window.setTimeout(() => setScanProgress(undefined), 4000);
    return () => window.clearTimeout(timeout);
  }, [scanProgress]);

  useEffect(() => {
    if (languagePreference !== "system") return;
    const handleLanguageChange = () => void i18n.changeLanguage(resolveLanguage("system"));
    window.addEventListener("languagechange", handleLanguageChange);
    return () => window.removeEventListener("languagechange", handleLanguageChange);
  }, [i18n, languagePreference]);

  useEffect(() => {
    if (!selectedTrack) {
      form.resetFields();
      return;
    }
    form.setFieldsValue({
      title: selectedTrack.title,
      artist: selectedTrack.artist,
      album: selectedTrack.album,
      albumArtist: selectedTrack.albumArtist,
      trackNumber: selectedTrack.trackNumber,
      discNumber: selectedTrack.discNumber,
      year: selectedTrack.year,
      genre: selectedTrack.genre,
      comment: selectedTrack.comment,
      lyrics: selectedTrack.lyrics,
    });
  }, [form, selectedTrack]);

  async function addFolders() {
    const selected = await open({ directory: true, multiple: true, title: t("folders.add") });
    const selectedPaths = Array.isArray(selected) ? selected : typeof selected === "string" ? [selected] : [];
    const newPaths = selectedPaths.filter((path) => !folders.some((folder) => samePath(folder.path, path)));
    if (newPaths.length === 0) return;
    for (const path of newPaths) await scanAndMergeFolder(path);
  }

  async function scanAndMergeFolder(path: string) {
    setLoading(true);
    setFolders((current) => upsertFolder(current, { path, trackCount: 0, status: "scanning" }));
    try {
      const folderTracks = await scanFolder(path);
      const scannedAt = new Date().toISOString();
      setTracks((current) => mergeFolderTracks(current, folderTracks, path));
      setFolders((current) =>
        upsertFolder(current, { path, trackCount: folderTracks.length, status: "ready", lastScannedAt: scannedAt }),
      );
      setSelectedFolderPath(path);
      setSelectedPath((current) => current ?? folderTracks[0]?.path);
      message.success(t("messages.scanned", { count: folderTracks.length }));
    } catch (error) {
      const failedFolder = { path, trackCount: 0, status: "error" as const, error: String(error) };
      setFolders((current) => upsertFolder(current, failedFolder));
      await upsertLibraryFolder(failedFolder).catch(() => undefined);
      message.error(String(error));
    } finally {
      setLoading(false);
    }
  }

  function selectTrack(path?: string) {
    setSelectedPath(path);
    if (detailTrack?.path !== path) setDetailTrack(undefined);
  }

  async function openTrackDetails(path = selectedPath) {
    if (!path) return;
    setSelectedPath(path);
    setDetailsOpen(true);
    if (detailTrack?.path === path) return;

    const requestId = ++detailRequest.current;
    setDetailTrack(undefined);
    setDetailsLoading(true);
    try {
      const fullTrack = await loadLibraryTrack(path);
      if (requestId === detailRequest.current) setDetailTrack(fullTrack);
    } catch (error) {
      if (requestId === detailRequest.current) message.error(String(error));
    } finally {
      if (requestId === detailRequest.current) setDetailsLoading(false);
    }
  }

  async function refreshSelected() {
    if (!selectedTrack) return;
    setLoading(true);
    try {
      const refreshed = await readAudioFile(selectedTrack.path);
      replaceTrack(refreshed);
      setDetailTrack(refreshed);
      message.success(t("messages.reloaded"));
    } catch (error) {
      message.error(String(error));
    } finally {
      setLoading(false);
    }
  }

  async function saveSelected() {
    if (!selectedTrack) {
      message.warning(t("messages.selectSong"));
      return;
    }
    setSaving(true);
    try {
      const values = await form.validateFields();
      const saved = await saveAudioTags(selectedTrack.path, values);
      replaceTrack(saved);
      setDetailTrack(saved);
      setSelectedPath(saved.path);
      message.success(t("messages.saved"));
    } catch (error) {
      message.error(String(error));
    } finally {
      setSaving(false);
    }
  }

  async function removeFolder(path: string) {
    setFolders((current) => current.filter((folder) => !samePath(folder.path, path)));
    setTracks((current) => current.filter((track) => !isTrackUnderFolder(track.path, path)));
    setSelectedPaths((current) => current.filter((trackPath) => !isTrackUnderFolder(trackPath, path)));
    if (samePath(selectedFolderPath ?? "", path)) setSelectedFolderPath(undefined);
    if (selectedPath && isTrackUnderFolder(selectedPath, path)) selectTrack(undefined);
    await removeLibraryFolder(path).catch((error) => message.error(String(error)));
  }

  function replaceTrack(nextTrack: AudioTrack) {
    setTracks((current) => current.map((track) => (samePath(track.path, nextTrack.path) ? nextTrack : track)));
    updateCachedCover(nextTrack.path, nextTrack.coverDataUrl);
  }

  function updatePlugin(plugin: SourcePlugin) {
    setPlugins((current) => current.map((candidate) => (candidate.id === plugin.id ? plugin : candidate)));
  }

  function changeLanguage(preference: LanguagePreference) {
    setLanguagePreference(preference);
    void persistLanguagePreference(preference);
  }

  function changeArtistSplitConfig(config: ArtistSplitConfig) {
    setArtistSplitConfig(config);
    artistSplitSaveQueue.current = artistSplitSaveQueue.current
      .then(() => saveArtistSplitConfig(config))
      .catch((error) => {
        message.error(String(error));
      });
  }

  function renderActivePage() {
    switch (activeView) {
      case "albums":
        return (
          <AlbumsPage
            albums={albums}
            query={query}
            selectedAlbumId={selectedAlbumId}
            selectedPath={selectedPath}
            detailsOpen={albumDetailsOpen}
            loading={loading}
            onChangeQuery={setQuery}
            onSelectAlbum={(albumId) => {
              setSelectedAlbumId(albumId);
              setAlbumDetailsOpen(true);
            }}
            onSelectTrack={selectTrack}
            onOpenTrack={openTrackDetails}
            onOpenDetails={() => setAlbumDetailsOpen(true)}
            onCloseDetails={() => setAlbumDetailsOpen(false)}
          />
        );
      case "artists":
        return (
          <ArtistsPage
            artists={artists}
            query={query}
            selectedArtistId={selectedArtistId}
            selectedPath={selectedPath}
            detailsOpen={artistDetailsOpen}
            loading={loading}
            onChangeQuery={setQuery}
            onSelectArtist={(artistId) => {
              setSelectedArtistId(artistId);
              setArtistDetailsOpen(true);
            }}
            onSelectTrack={selectTrack}
            onOpenTrack={openTrackDetails}
            onOpenDetails={() => setArtistDetailsOpen(true)}
            onCloseDetails={() => setArtistDetailsOpen(false)}
          />
        );
      case "folders":
        return (
          <FoldersPage
            folders={folders}
            tracks={tracks}
            selectedFolderPath={selectedFolderPath}
            selectedTrackPath={selectedPath}
            loading={loading}
            onAddFolders={addFolders}
            onRescanFolder={scanAndMergeFolder}
            onRemoveFolder={removeFolder}
            onSelectFolder={setSelectedFolderPath}
            onSelectTrack={selectTrack}
            onOpenTrack={openTrackDetails}
          />
        );
      case "sources":
        return <PluginsPage plugins={plugins} tracks={tracks} onChangePlugin={updatePlugin} />;
      case "tasks":
        return <TasksPage tracks={tracks} plugins={plugins} />;
      case "settings":
        return (
          <SettingsPage
            languagePreference={languagePreference}
            folderCount={folders.length}
            trackCount={tracks.length}
            plugins={plugins}
            artistSplitConfig={artistSplitConfig}
            onChangeLanguage={changeLanguage}
            onChangeArtistSplitConfig={changeArtistSplitConfig}
            onNavigate={setActiveView}
          />
        );
      case "songs":
      default:
        return (
          <SongsPage
            tracks={filteredTracks}
            query={query}
            selectedTrack={selectedTrack}
            selectedPath={selectedPath}
            selectedPaths={selectedPaths}
            loading={loading}
            onChangeQuery={setQuery}
            onSelectTrack={selectTrack}
            onChangeSelectedPaths={setSelectedPaths}
            onReloadTrack={refreshSelected}
            onOpenDetails={openTrackDetails}
          />
        );
    }
  }

  return (
    <Shell
      activeView={activeView}
      folders={folders}
      trackCount={tracks.length}
      scanProgress={scanProgress}
      onChangeView={setActiveView}
    >
      {renderActivePage()}
      <SongDetails
        open={detailsOpen}
        loading={detailsLoading}
        track={selectedTrack}
        form={form}
        saving={saving}
        onSave={saveSelected}
        onReload={refreshSelected}
        onClose={() => setDetailsOpen(false)}
      />
    </Shell>
  );
}

function upsertFolder(folders: LibraryFolder[], folder: LibraryFolder) {
  const rest = folders.filter((candidate) => !samePath(candidate.path, folder.path));
  return [...rest, folder].sort((left, right) => left.path.localeCompare(right.path));
}

function mergeFolderTracks(current: AudioTrack[], folderTracks: AudioTrack[], folderPath: string) {
  const remaining = current.filter((track) => !isTrackUnderFolder(track.path, folderPath));
  const seen = new Set<string>();
  return [...remaining, ...folderTracks].filter((track) => {
    const key = normalizePath(track.path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isTrackUnderFolder(trackPath: string, folderPath: string) {
  return normalizePath(trackPath).startsWith(normalizeFolderPath(folderPath));
}

function samePath(left: string, right: string) {
  return normalizePath(left) === normalizePath(right);
}

function normalizeFolderPath(path: string) {
  const normalized = normalizePath(path);
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function normalizePath(path: string) {
  return path.replace(/\\/g, "/").toLocaleLowerCase();
}
