import common from "./common.json";
import editor from "./editor.json";
import library from "./library.json";
import plugins from "./plugins.json";
import settings from "./settings.json";
import tasks from "./tasks.json";

const translation = {
  ...common,
  ...library,
  ...editor,
  ...settings,
  ...plugins,
  ...tasks,
} as const;

export default translation;
