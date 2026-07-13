import {
  CloudSyncOutlined,
  CopyOutlined,
  CustomerServiceOutlined,
  FolderOutlined,
  ScissorOutlined,
  SettingOutlined,
  TagsOutlined,
} from "@ant-design/icons";
import { Menu, type MenuProps } from "antd";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ViewKey } from "../app/types";

type MenuState = { x: number; y: number; target: HTMLElement; editable: boolean };

export function AppContextMenu({ onNavigate }: { onNavigate: (view: ViewKey) => void }) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<MenuState>();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const openMenu = (event: MouseEvent) => {
      event.preventDefault();
      const target = event.target instanceof HTMLElement ? event.target : document.body;
      const editableTarget = findEditableTarget(target);
      setMenu({ x: event.clientX, y: event.clientY, target: editableTarget ?? target, editable: Boolean(editableTarget) });
    };
    const closeMenu = () => setMenu(undefined);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("contextmenu", openMenu);
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("blur", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("contextmenu", openMenu);
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("blur", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element || !menu) return;
    const bounds = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - bounds.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - bounds.height - 8))}px`;
  }, [menu]);

  if (!menu) return null;

  const items: MenuProps["items"] = menu.editable
    ? [
        { key: "undo", label: t("contextMenu.undo") },
        { key: "redo", label: t("contextMenu.redo") },
        { type: "divider" },
        { key: "cut", icon: <ScissorOutlined />, label: t("contextMenu.cut") },
        { key: "copy", icon: <CopyOutlined />, label: t("contextMenu.copy") },
        { key: "paste", label: t("contextMenu.paste") },
        { key: "selectAll", label: t("contextMenu.selectAll") },
      ]
    : [
        { key: "songs", icon: <CustomerServiceOutlined />, label: t("common.songs") },
        { key: "folders", icon: <FolderOutlined />, label: t("common.folders") },
        { key: "sources", icon: <TagsOutlined />, label: t("common.sources") },
        { key: "tasks", icon: <CloudSyncOutlined />, label: t("common.tasks") },
        { type: "divider" },
        { key: "settings", icon: <SettingOutlined />, label: t("common.settings") },
      ];

  const handleClick: MenuProps["onClick"] = ({ key }) => {
    if (menu.editable) void executeEditCommand(key, menu.target).catch(() => undefined);
    else onNavigate(key as ViewKey);
    setMenu(undefined);
  };

  return (
    <div ref={menuRef} className="app-context-menu" role="menu" onPointerDown={(event) => event.stopPropagation()}>
      <Menu selectable={false} items={items} onClick={handleClick} />
    </div>
  );
}

function findEditableTarget(target: HTMLElement) {
  const candidate = target.closest("input, textarea, [contenteditable='true']");
  if (!(candidate instanceof HTMLElement)) return undefined;
  if (candidate instanceof HTMLInputElement && (candidate.disabled || candidate.readOnly)) return undefined;
  if (candidate instanceof HTMLTextAreaElement && (candidate.disabled || candidate.readOnly)) return undefined;
  return candidate;
}

async function executeEditCommand(command: string, target: HTMLElement) {
  target.focus();
  if (command === "paste") {
    const value = await navigator.clipboard.readText();
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? start;
      target.setRangeText(value, start, end, "end");
      target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: value }));
    } else {
      document.execCommand("insertText", false, value);
    }
    return;
  }
  const browserCommand = command === "selectAll" ? "selectAll" : command;
  document.execCommand(browserCommand);
}
