import { open, save } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { App as AntApp, ConfigProvider, Form, theme } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  loadLibraryFolders,
  loadArtistSplitConfig,
  loadLibraryTrack,
  loadLibraryTracks,
  loadBatchTaskItems,
  readAudioFile,
  readImageFile,
  readTextFile,
  removeLibraryFolder,
  saveAudioTags,
  saveArtistSplitConfig,
  analyzeReplayGain,
  cancelBatchTask,
  cancelReplayGain,
  scanFolder,
  upsertLibraryFolder,
  writeTextFile,
  writeImageFile,
  loadSourcePlugins,
  loadDesktopSettings,
  installSourcePluginArchive,
  saveSourcePluginSettings,
  saveDesktopSettings,
  setSourcePluginEnabled,
  uninstallSourcePlugin,
} from "../backend/audioApi";
import { Shell } from "../components/Shell";
import { TitleBar } from "../components/TitleBar";
import { AppContextMenu } from "../components/AppContextMenu";
import { SongDetails } from "../components/SongDetails";
import { defaultArtistSplitConfig, filterTracks, groupAlbums, groupArtists } from "../domain/library";
import { completeTagForm, splitGenreValues } from "../domain/tagForm";
import { detectLyricsFormat } from "../backend/lyricsApi";
import { updateCachedCover } from "../hooks/useTrackCovers";
import {
  getLanguagePreference,
  resolveLanguage,
  setLanguagePreference as persistLanguagePreference,
  type LanguagePreference,
} from "../i18n";
import type { ArtistSplitConfig, AudioTrack, BatchTask, BatchTaskItem, DesktopSettings, LibraryFolder, ScanProgress, SourcePlugin, TagForm, ViewKey } from "./types";

const AlbumsPage = lazy(() => import("../pages/AlbumsPage").then((m) => ({ default: m.AlbumsPage })));
const ArtistsPage = lazy(() => import("../pages/ArtistsPage").then((m) => ({ default: m.ArtistsPage })));
const FoldersPage = lazy(() => import("../pages/FoldersPage").then((m) => ({ default: m.FoldersPage })));
const PluginsPage = lazy(() => import("../pages/PluginsPage").then((m) => ({ default: m.PluginsPage })));
const SettingsPage = lazy(() => import("../pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const SongsPage = lazy(() => import("../pages/SongsPage").then((m) => ({ default: m.SongsPage })));
const TasksPage = lazy(() => import("../pages/TasksPage").then((m) => ({ default: m.TasksPage })));
import { getReplayGainProgress, publishReplayGainProgress } from "../hooks/useReplayGainProgress";
import "../App.css";

const defaultDesktopSettings: DesktopSettings = {
  searchPageSize: 10,
  lyricFormat: "verbatimLrc",
  lyricsConversionMode: "none",
  showTranslation: true,
  showRomanization: true,
  onlyTranslationIfAvailable: false,
  removeEmptyLyricLines: true,
  renameCharacterMappings: {
    "\\": "＼", "/": "／", ":": "：", "*": "＊", "?": "？", "\"": "＂", "<": "＜", ">": "＞", "|": "｜",
  },
  theme: "system",
};

export default function App() {
  const { i18n } = useTranslation();
  const antLocale = i18n.resolvedLanguage?.startsWith("zh") ? zhCN : enUS;
  const [themePreference, setThemePreference] = useState<DesktopSettings["theme"]>("system");

  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? "en-US";
  }, [i18n.resolvedLanguage]);

  const resolvedTheme = useMemo(() => {
    if (themePreference === "system") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return themePreference;
  }, [themePreference]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    if (themePreference !== "system") return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      document.documentElement.setAttribute("data-theme", mediaQuery.matches ? "dark" : "light");
    };
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, [themePreference]);

  return (
    <ConfigProvider
      locale={antLocale}
      theme={{
        cssVar: {},
        algorithm: resolvedTheme === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: "#1677ff",
          borderRadius: 8,
          fontFamily:
            "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
        },
      }}
    >
      <AntApp>
        <LyricoDesktop onThemeChange={setThemePreference} />
      </AntApp>
    </ConfigProvider>
  );
}

function PageFallback() {
  return null;
}

function LyricoDesktop({ onThemeChange }: { onThemeChange: (theme: DesktopSettings["theme"]) => void }) {
  const { message } = AntApp.useApp();
  const { t, i18n } = useTranslation();
  const [activeView, setActiveView] = useState<ViewKey>("songs");
  const [tracks, setTracks] = useState<AudioTrack[]>([]);
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>();
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
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
  const [plugins, setPlugins] = useState<SourcePlugin[]>([]);
  const [artistSplitConfig, setArtistSplitConfig] = useState<ArtistSplitConfig>(defaultArtistSplitConfig);
  const [desktopSettings, setDesktopSettings] = useState<DesktopSettings>(defaultDesktopSettings);
  const [languagePreference, setLanguagePreference] = useState<LanguagePreference>(getLanguagePreference);
  const [scanProgress, setScanProgress] = useState<ScanProgress>();
  const [form] = Form.useForm<TagForm>();
  const detailRequest = useRef(0);
  const artistSplitSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const settingsSaveQueue = useRef<Promise<void>>(Promise.resolve());
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
  const trackByPath = useMemo(() => {
    const map = new Map<string, AudioTrack>();
    for (const track of tracks) map.set(track.path, track);
    return map;
  }, [tracks]);
  const selectedTrackSummary = useMemo(() => (selectedPath ? trackByPath.get(selectedPath) : undefined), [trackByPath, selectedPath]);
  const selectedTrack = detailTrack?.path === selectedPath ? detailTrack : selectedTrackSummary;
  const selectedTracks = useMemo(() => {
    return selectedPaths.flatMap((path) => {
      const track = trackByPath.get(path);
      return track ? [track] : [];
    });
  }, [selectedPaths, trackByPath]);

  useEffect(() => {
    Promise.all([loadLibraryFolders(), loadLibraryTracks(), loadArtistSplitConfig(), loadSourcePlugins(), loadDesktopSettings()])
      .then(([storedFolders, storedTracks, storedArtistSplitConfig, storedPlugins, storedSettings]) => {
        setFolders(storedFolders);
        setTracks(storedTracks);
        setSelectedFolderPath(storedFolders[0]?.path);
        setSelectedPath(storedTracks[0]?.path);
        setSelectedPaths([]);
        setArtistSplitConfig(storedArtistSplitConfig);
        setPlugins(storedPlugins);
        setDesktopSettings(storedSettings);
        onThemeChange(storedSettings.theme);
      })
      .catch(() => {
        setFolders([]);
        setTracks([]);
        setPlugins([]);
        setDesktopSettings(defaultDesktopSettings);
      });
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    void listen<BatchTask>("batch-task-updated", ({ payload }) => {
      if (!disposed && ["succeeded", "failed", "cancelled"].includes(payload.status)) {
        void Promise.all([
          loadLibraryTracks(),
          payload.taskType === "renameFiles" ? loadBatchTaskItems(payload.taskId) : Promise.resolve([]),
        ]).then(([nextTracks, items]) => {
          if (disposed) return;
          setTracks(nextTracks);
          const renamedPaths = renamePathMap(items);
          if (renamedPaths.size === 0) return;
          setSelectedPath((current) => current ? renamedPaths.get(normalizePath(current)) ?? current : current);
          setSelectedPaths((current) => current.map((path) => renamedPaths.get(normalizePath(path)) ?? path));
          setDetailTrack((current) => current && renamedPaths.has(normalizePath(current.path)) ? undefined : current);
        }).catch(() => undefined);
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
    form.resetFields();
    form.setFieldsValue({
      title: selectedTrack.title,
      artist: selectedTrack.artist,
      album: selectedTrack.album,
      albumArtist: selectedTrack.albumArtist,
      trackNumber: selectedTrack.trackNumber,
      discNumber: selectedTrack.discNumber,
      year: selectedTrack.year,
      genre: splitGenreValues(selectedTrack.genre),
      language: selectedTrack.language,
      composer: selectedTrack.composer,
      lyricist: selectedTrack.lyricist,
      copyright: selectedTrack.copyright,
      rating: selectedTrack.rating,
      comment: selectedTrack.comment,
      lyrics: selectedTrack.lyrics,
      replayGainTrackGain: selectedTrack.replayGainTrackGain,
      replayGainTrackPeak: selectedTrack.replayGainTrackPeak,
      replayGainAlbumGain: selectedTrack.replayGainAlbumGain,
      replayGainAlbumPeak: selectedTrack.replayGainAlbumPeak,
      replayGainReferenceLoudness: selectedTrack.replayGainReferenceLoudness,
      coverDataUrl: undefined,
      removeCover: false,
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

  const selectTrack = useCallback(function selectTrack(path?: string) {
    setSelectedPath(path);
    if (detailTrack?.path !== path) setDetailTrack(undefined);
  }, [detailTrack]);

  const openTrackDetails = useCallback(async function openTrackDetails(path = selectedPath) {
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
  }, [selectedPath, detailTrack, message]);

  const refreshSelected = useCallback(async function refreshSelected() {
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
  }, [selectedTrack, t, message]);

  async function saveSelected() {
    if (!selectedTrack) {
      message.warning(t("messages.selectSong"));
      return;
    }
    setSaving(true);
    try {
      await form.validateFields();
      const values = completeTagForm(form.getFieldsValue(true), selectedTrack);
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

  const openBatchForSelection = useCallback(function openBatchForSelection() {
    if (selectedPaths.length === 0) {
      message.warning(t("messages.selectSongs"));
      return;
    }
    setDetailsOpen(false);
    setAlbumDetailsOpen(false);
    setArtistDetailsOpen(false);
    setSelectionMode(false);
    setActiveView("tasks");
  }, [selectedPaths.length, t, message]);

  const changeSelectionMode = useCallback(function changeSelectionMode(enabled: boolean) {
    setSelectedPaths([]);
    setSelectionMode(enabled);
  }, []);

  const onChangeQuery = useCallback(setQuery, []);
  const onChangeSelectedPaths = useCallback(setSelectedPaths, []);

  const onSelectAlbum = useCallback((albumId?: string) => {
    if (albumId) setSelectedAlbumId(albumId);
    setAlbumDetailsOpen(true);
  }, []);

  const onAlbumOpenTrack = useCallback((path: string) => {
    setAlbumDetailsOpen(false);
    void openTrackDetails(path);
  }, [openTrackDetails]);

  const onAlbumOpenDetails = useCallback(() => setAlbumDetailsOpen(true), []);
  const onAlbumCloseDetails = useCallback(() => setAlbumDetailsOpen(false), []);

  const onSelectArtist = useCallback((artistId?: string) => {
    if (artistId) setSelectedArtistId(artistId);
    setArtistDetailsOpen(true);
  }, []);

  const onArtistOpenTrack = useCallback((path: string) => {
    setArtistDetailsOpen(false);
    void openTrackDetails(path);
  }, [openTrackDetails]);

  const onArtistOpenDetails = useCallback(() => setArtistDetailsOpen(true), []);
  const onArtistCloseDetails = useCallback(() => setArtistDetailsOpen(false), []);

  const onRemoveSelectedTrack = useCallback((path: string) => setSelectedPaths((current) => current.filter((candidate) => candidate !== path)), []);
  const onClearSelectedTracks = useCallback(() => setSelectedPaths([]), []);

  async function calculateSelectedReplayGain() {
    if (!selectedTrack || getReplayGainProgress()?.status === "running") return;
    const jobId = crypto.randomUUID();
    publishReplayGainProgress({ jobId, path: selectedTrack.path, percent: 0, status: "running" });
    try {
      const result = await analyzeReplayGain(selectedTrack.path, jobId);
      form.setFieldsValue({
        replayGainTrackGain: result.trackGain,
        replayGainTrackPeak: result.trackPeak,
        replayGainReferenceLoudness: result.referenceLoudness,
      });
      message.success(t("messages.replayGainCalculated"));
    } catch (error) {
      if (!String(error).toLocaleLowerCase().includes("cancelled")) message.error(String(error));
    }
  }

  async function cancelActiveReplayGain() {
    const progress = getReplayGainProgress();
    if (progress?.status !== "running") return;
    const batchTaskId = progress.jobId.includes(":") ? progress.jobId.split(":", 1)[0] : undefined;
    const request = batchTaskId?.startsWith("batch-") ? cancelBatchTask(batchTaskId) : cancelReplayGain(progress.jobId);
    await request.catch((error) => message.error(String(error)));
  }

  async function chooseLocalCover() {
    const selected = await open({
      multiple: false,
      title: t("cover.choose"),
      filters: [{ name: t("cover.images"), extensions: ["jpg", "jpeg", "png", "webp", "gif"] }],
    });
    if (typeof selected !== "string") return;
    try {
      const coverDataUrl = await readImageFile(selected);
      form.setFieldsValue({ coverDataUrl, removeCover: false });
    } catch (error) {
      message.error(String(error));
    }
  }

  async function useSameAlbumCover() {
    if (!selectedTrack?.album) return;
    const candidate = tracks.find((track) =>
      track.path !== selectedTrack.path && track.hasCover && track.album === selectedTrack.album,
    );
    if (!candidate) {
      message.warning(t("cover.noAlbumCover"));
      return;
    }
    try {
      const source = await loadLibraryTrack(candidate.path);
      if (!source.coverDataUrl) throw new Error(t("cover.noAlbumCover"));
      form.setFieldsValue({ coverDataUrl: source.coverDataUrl, removeCover: false });
    } catch (error) {
      message.error(String(error));
    }
  }

  function removeSelectedCover() {
    form.setFieldsValue({ coverDataUrl: undefined, removeCover: true });
  }

  function revertSelectedCover() {
    form.setFieldsValue({ coverDataUrl: undefined, removeCover: false });
  }

  async function exportSelectedCover() {
    if (!selectedTrack || form.getFieldValue("removeCover")) {
      message.warning(t("cover.empty"));
      return;
    }
    const dataUrl = String(form.getFieldValue("coverDataUrl") ?? selectedTrack.coverDataUrl ?? "");
    if (!dataUrl) {
      message.warning(t("cover.empty"));
      return;
    }
    const extension = dataUrl.startsWith("data:image/png") ? "png" : dataUrl.startsWith("data:image/webp") ? "webp" : dataUrl.startsWith("data:image/gif") ? "gif" : "jpg";
    const baseName = selectedTrack.fileName.replace(/\.[^.]+$/, "");
    const destination = await save({
      title: t("cover.export"),
      defaultPath: `${baseName}-cover.${extension}`,
      filters: [{ name: t("cover.images"), extensions: [extension] }],
    });
    if (!destination) return;
    try {
      await writeImageFile(destination, dataUrl);
      message.success(t("messages.coverExported"));
    } catch (error) {
      message.error(String(error));
    }
  }

  async function importLyricsFile() {
    const selected = await open({
      multiple: false,
      title: t("lyrics.import"),
      filters: [{ name: t("lyrics.files"), extensions: ["lrc", "ttml", "txt"] }],
    });
    if (typeof selected !== "string") return;
    try {
      form.setFieldValue("lyrics", await readTextFile(selected));
      message.success(t("messages.lyricsImported"));
    } catch (error) {
      message.error(String(error));
    }
  }

  async function exportLyricsFile() {
    const lyrics = String(form.getFieldValue("lyrics") ?? "");
    if (!lyrics.trim() || !selectedTrack) {
      message.warning(t("lyrics.empty"));
      return;
    }
    try {
      const extension = await detectLyricsFormat(lyrics) === "ttml" ? "ttml" : "lrc";
      const baseName = selectedTrack.fileName.replace(/\.[^.]+$/, "");
      const destination = await save({
        title: t("lyrics.export"),
        defaultPath: `${baseName}.${extension}`,
        filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
      });
      if (!destination) return;
      await writeTextFile(destination, lyrics);
      message.success(t("messages.lyricsExported"));
    } catch (error) {
      message.error(String(error));
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

  async function installPlugin() {
    const archivePath = await open({
      title: t("sources.install"),
      multiple: false,
      directory: false,
      filters: [{ name: "Lyrico plugin", extensions: ["zip"] }],
    });
    if (typeof archivePath !== "string") return;
    try {
      const result = await installSourcePluginArchive(archivePath);
      setPlugins(await loadSourcePlugins());
      if (result.installed.length) message.success(t("sources.installSuccess", { count: result.installed.length }));
      if (result.failed.length) {
        message.error(result.failed.map((failure) => failure.reason).join("; "));
      }
    } catch (error) {
      message.error(String(error));
    }
  }

  async function changePluginEnabled(pluginId: string, enabled: boolean) {
    try {
      setPlugins(await setSourcePluginEnabled(pluginId, enabled));
    } catch (error) {
      message.error(String(error));
    }
  }

  async function savePluginConfig(pluginId: string, config: Record<string, string>) {
    try {
      setPlugins(await saveSourcePluginSettings(pluginId, config));
      message.success(t("sources.configSaved"));
    } catch (error) {
      message.error(String(error));
      throw error;
    }
  }

  async function uninstallPlugin(pluginId: string) {
    try {
      setPlugins(await uninstallSourcePlugin(pluginId));
      message.success(t("sources.uninstallSuccess"));
    } catch (error) {
      message.error(String(error));
      throw error;
    }
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

  function changeDesktopSettings(settings: DesktopSettings) {
    setDesktopSettings(settings);
    onThemeChange(settings.theme);
    settingsSaveQueue.current = settingsSaveQueue.current
      .then(() => saveDesktopSettings(settings))
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
            onChangeQuery={onChangeQuery}
            onSelectAlbum={onSelectAlbum}
            onSelectTrack={selectTrack}
            onOpenTrack={onAlbumOpenTrack}
            onOpenDetails={onAlbumOpenDetails}
            onCloseDetails={onAlbumCloseDetails}
            selectedPaths={selectedPaths}
            selectionMode={selectionMode}
            onChangeSelectedPaths={onChangeSelectedPaths}
            onChangeSelectionMode={changeSelectionMode}
            onOpenBatch={openBatchForSelection}
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
            onChangeQuery={onChangeQuery}
            onSelectArtist={onSelectArtist}
            onSelectTrack={selectTrack}
            onOpenTrack={onArtistOpenTrack}
            onOpenDetails={onArtistOpenDetails}
            onCloseDetails={onArtistCloseDetails}
            selectedPaths={selectedPaths}
            selectionMode={selectionMode}
            onChangeSelectedPaths={onChangeSelectedPaths}
            onChangeSelectionMode={changeSelectionMode}
            onOpenBatch={openBatchForSelection}
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
            selectedPaths={selectedPaths}
            selectionMode={selectionMode}
            onChangeSelectedPaths={onChangeSelectedPaths}
            onChangeSelectionMode={changeSelectionMode}
            onOpenBatch={openBatchForSelection}
          />
        );
      case "sources":
        return (
          <PluginsPage
            plugins={plugins}
            onInstall={installPlugin}
            onChangeEnabled={changePluginEnabled}
            onSaveConfig={savePluginConfig}
            onUninstall={uninstallPlugin}
          />
        );
      case "tasks":
        return (
          <TasksPage
            tracks={tracks}
            plugins={plugins}
            selectedPaths={selectedPaths}
            settings={desktopSettings}
            artistSeparator={artistSplitConfig.artistSeparator}
            onChangeSettings={changeDesktopSettings}
          />
        );
      case "settings":
        return (
          <SettingsPage
            languagePreference={languagePreference}
            artistSplitConfig={artistSplitConfig}
            settings={desktopSettings}
            onChangeLanguage={changeLanguage}
            onChangeArtistSplitConfig={changeArtistSplitConfig}
            onChangeSettings={changeDesktopSettings}
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
            onChangeQuery={onChangeQuery}
            onSelectTrack={selectTrack}
            onChangeSelectedPaths={onChangeSelectedPaths}
            selectionMode={selectionMode}
            onChangeSelectionMode={changeSelectionMode}
            onOpenBatch={openBatchForSelection}
            onReloadTrack={refreshSelected}
            onOpenDetails={openTrackDetails}
          />
        );
    }
  }

  return (
    <>
    <TitleBar />
      <Shell
      activeView={activeView}
      folders={folders}
      trackCount={tracks.length}
      scanProgress={scanProgress}
      selectedTracks={selectedTracks}
      onChangeView={setActiveView}
      onCancelReplayGain={cancelActiveReplayGain}
      onRemoveSelectedTrack={onRemoveSelectedTrack}
      onClearSelectedTracks={onClearSelectedTracks}
      onOpenSelectedBatch={openBatchForSelection}
    >
      <Suspense fallback={<PageFallback />}>{renderActivePage()}</Suspense>
      <SongDetails
        open={detailsOpen}
        loading={detailsLoading}
        track={selectedTrack}
        plugins={plugins}
        settings={desktopSettings}
        form={form}
        saving={saving}
        onSave={saveSelected}
        onReload={refreshSelected}
        onCalculateReplayGain={calculateSelectedReplayGain}
        onCancelReplayGain={cancelActiveReplayGain}
        onChooseCover={chooseLocalCover}
        onUseSameAlbumCover={useSameAlbumCover}
        onRemoveCover={removeSelectedCover}
        onRevertCover={revertSelectedCover}
        onExportCover={exportSelectedCover}
        onImportLyrics={importLyricsFile}
        onExportLyrics={exportLyricsFile}
        onClose={() => setDetailsOpen(false)}
      />
    </Shell>
    <AppContextMenu onNavigate={setActiveView} />
    </>
  );
}

function upsertFolder(folders: LibraryFolder[], folder: LibraryFolder) {
  const rest = folders.filter((candidate) => !samePath(candidate.path, folder.path));
  return [...rest, folder].sort((left, right) => left.path.localeCompare(right.path));
}

function renamePathMap(items: BatchTaskItem[]) {
  const paths = new Map<string, string>();
  for (const item of items) {
    if (item.status !== "succeeded" || !item.resultJson) continue;
    try {
      const result = JSON.parse(item.resultJson) as { originalPath?: string; newPath?: string };
      if (result.originalPath && result.newPath) paths.set(normalizePath(result.originalPath), result.newPath);
    } catch {
      // Ignore malformed historical task results and keep the current selection unchanged.
    }
  }
  return paths;
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
