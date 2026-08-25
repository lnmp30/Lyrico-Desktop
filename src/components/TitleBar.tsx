import { MinusOutlined, CloseOutlined, BorderOutlined, BlockOutlined } from "@ant-design/icons";
import { Button, Typography } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import appIcon from "../../src-tauri/icons/128x128.png";

const { Text } = Typography;

export function TitleBar() {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    appWindow.isMaximized().then(setMaximized);
    let unlisten: (() => void) | undefined;
    appWindow.onResized(() => {
      appWindow.isMaximized().then(setMaximized);
    }).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, []);

  async function handleMinimize() {
    await getCurrentWindow().minimize();
  }

  async function handleMaximize() {
    const appWindow = getCurrentWindow();
    if (await appWindow.isMaximized()) {
      await appWindow.unmaximize();
    } else {
      await appWindow.maximize();
    }
    setMaximized(await appWindow.isMaximized());
  }

  async function handleClose() {
    await getCurrentWindow().close();
  }

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-brand" data-tauri-drag-region>
        <img src={appIcon} alt="" className="titlebar-icon" draggable={false} data-tauri-drag-region />
        <Text strong className="titlebar-title" data-tauri-drag-region>Lyrico</Text>
      </div>
      <div className="titlebar-controls">
        <Button
          type="text"
          className="titlebar-btn"
          icon={<MinusOutlined />}
          onClick={handleMinimize}
          aria-label={t("common.minimize")}
        />
        <Button
          type="text"
          className="titlebar-btn"
          icon={maximized ? <BlockOutlined /> : <BorderOutlined />}
          onClick={handleMaximize}
          aria-label={maximized ? t("common.restore") : t("common.maximize")}
        />
        <Button
          type="text"
          className="titlebar-btn titlebar-btn-close"
          icon={<CloseOutlined />}
          onClick={handleClose}
          aria-label={t("common.close")}
        />
      </div>
    </div>
  );
}
