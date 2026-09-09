import * as React from "react";
import * as Cookies from "cookies-js";
import { setDebug, isDebug } from "../../../packages/lib/debug";
import { Button, ToggleButton } from "../controls";
import { EditorThemes, Game } from "../../../packages/lib/types";
import {
  CCompilerKind,
  ClangOptLevel,
  CLANG_OPT_LEVELS,
  parseCCompilerKind,
  parseClangOptLevel,
  setCCompilerKind,
  setClangOptLevel,
} from "../../../packages/lib/utils/c-compiler-kind";
import {
  DEFAULT_DECOMP_SYMBOL_SOURCES,
  IExtraSymbolSource,
  addExtraSymbolListener,
  createExtraSymbolSourceId,
  getExtraSymbolStatuses,
  loadExtraSymbolSources,
  parseExtraSymbolSources,
  removeInlineSymbolFile,
  writeInlineSymbolFile,
} from "../../../packages/lib/symbols/extra";
import {
  inferGameFromSymbolPath,
  parseSymFile,
} from "../../../packages/lib/symbols/parse";
import { openFile } from "../../../packages/lib/utils/input";

import "../css/settings.scss";

export enum $setting {
  "uiTheme" = "ui.theme",
  "uiAdvanced" = "ui.advanced",
  "uiDebug" = "ui.debug",
  "uiSkipValidation" = "ui.skipvalidation",
  "uiAllowAllRoms" = "ui.allowallroms",
  "uiShowRomBoards" = "ui.showromboards",
  "writeBranding" = "write.branding",
  "writeDecompressed" = "write.decompressed",
  "limitModelFPS" = "models.limitfps",
  "limitModelAnimations" = "models.limitAnimations",
  "modelUseGLB" = "models.useGLB",
  "cCompiler" = "c.compiler",
  "cOptLevel" = "c.optlevel",
  "symbolPaths" = "symbols.paths",
}

interface SettingTypeMap {
  [$setting.uiTheme]: "theme";
  [$setting.uiAdvanced]: "checkbox";
  [$setting.uiDebug]: "checkbox";
  [$setting.uiSkipValidation]: "checkbox";
  [$setting.uiAllowAllRoms]: "checkbox";
  [$setting.uiShowRomBoards]: "checkbox";
  [$setting.writeBranding]: "checkbox";
  [$setting.writeDecompressed]: "checkbox";
  [$setting.limitModelFPS]: "checkbox";
  [$setting.limitModelAnimations]: "checkbox";
  [$setting.modelUseGLB]: "checkbox";
  [$setting.cCompiler]: "ccompiler";
  [$setting.cOptLevel]: "clangopt";
  [$setting.symbolPaths]: "sympaths";
}

type SettingType = "checkbox" | "theme" | "ccompiler" | "clangopt" | "sympaths";

type SettingValueTypeForKey<TKey extends keyof SettingTypeMap> =
  SettingValueTypes[SettingTypeMap[TKey]];

interface SettingValueTypes {
  checkbox: boolean;
  theme: EditorThemes;
  ccompiler: CCompilerKind;
  clangopt: ClangOptLevel;
  sympaths: IExtraSymbolSource[];
}

interface ISettingConfig<T extends SettingType> {
  name: string;
  type: T;
  id: keyof SettingTypeMap;
  default: SettingValueTypes[T];
  desc?: string;
  advanced?: boolean;
}

interface ISettingSection {
  name: string;
  type: "section";
  advanced?: boolean;
}

type ISetting =
  | ISettingSection
  | ISettingConfig<"checkbox">
  | ISettingConfig<"theme">
  | ISettingConfig<"ccompiler">
  | ISettingConfig<"clangopt">
  | ISettingConfig<"sympaths">;

const _settings: ISetting[] = [
  { name: "Theme", type: "section" },
  {
    id: $setting.uiTheme,
    type: "theme",
    default: EditorThemes.Classic,
    name: "Theme",
  },
  { name: "UI", type: "section" },
  {
    id: $setting.uiAdvanced,
    type: "checkbox",
    default: false,
    name: "Advanced features",
    desc: "Enables infrequently used, potentially complicated, and developer features.",
  },
  {
    id: $setting.uiDebug,
    type: "checkbox",
    default: isDebug(),
    name: "Debug features",
    advanced: true,
    desc: "Enables debug output and UI that may aid development.",
  },
  {
    id: $setting.uiSkipValidation,
    type: "checkbox",
    default: false,
    name: "Skip Overwrite Validation",
    advanced: true,
    desc: "Allow boards to be written regardless of warnings.",
  },
  {
    id: $setting.uiShowRomBoards,
    type: "checkbox",
    default: false,
    name: "Show ROM Boards",
    advanced: true,
    desc: "Show boards parsed from the ROM in the editor.",
  },
  {
    id: $setting.uiAllowAllRoms,
    type: "checkbox",
    default: false,
    name: "Allow All ROMs",
    advanced: true,
    desc: "Allows more than just the officially supported ROMs to attempt to load.",
  },
  { name: "Symbols", type: "section", advanced: true },
  {
    id: $setting.symbolPaths,
    type: "sympaths",
    default: DEFAULT_DECOMP_SYMBOL_SOURCES,
    name: "Symbol files",
    advanced: true,
    desc: "NTSC-U splat symbol_addrs.txt or .sym CSV files merged with the built-in names. Defaults are the mariopartyrd decomps. Game is inferred from the URL or filename (marioparty3, MarioParty2U.sym, …).",
  },
  { name: "C Compiler", type: "section" },
  {
    id: $setting.cCompiler,
    type: "ccompiler",
    default: CCompilerKind.Clang,
    name: "C compiler",
    desc: "Clang is the default compiler for C events. SmallerC is legacy and only for older event scripts.",
  },
  { name: "ROM", type: "section" },
  {
    id: $setting.writeBranding,
    type: "checkbox",
    default: true,
    name: "Include branding",
    desc: "Adds the PartyPlanner64 logo to the game boot splashscreens.",
  },
  {
    id: $setting.writeDecompressed,
    type: "checkbox",
    default: false,
    name: "Leave ROM decompressed",
    advanced: true,
    desc: "Leaves all files decompressed when saving a ROM, resulting in larger file size.",
  },
  { name: "Model Viewer", type: "section" },
  {
    id: $setting.limitModelFPS,
    type: "checkbox",
    default: true,
    name: "Limit FPS",
    desc: "Reduce the refresh rate for better performance.",
  },
  {
    id: $setting.limitModelAnimations,
    type: "checkbox",
    default: true,
    name: "Limit animations",
    desc: "Limit animations to those in the same directory as the model.",
  },
  {
    id: $setting.modelUseGLB,
    type: "checkbox",
    default: false,
    name: "Use GLB container for glTF",
    desc: "Create a GLB container when exporting models to glTF.",
  },
];
function _getSetting<TKey extends keyof SettingTypeMap>(id: TKey) {
  return _settings.find((setting) => {
    if (setting.type === "section") return false;
    return (setting as ISettingConfig<any>).id === id;
  });
}
function _getSettingDefault<TKey extends keyof SettingTypeMap>(
  id: TKey,
): SettingValueTypeForKey<TKey> | undefined {
  const setting = _getSetting(id);
  if (setting && setting.type !== "section")
    return (setting as ISettingConfig<SettingTypeMap[TKey]>).default;
  return undefined;
}

class SettingsManager {
  private _tempSettings: { [settingName: string]: any };

  public listeners: Set<SettingChangedListener> = new Set();

  constructor() {
    this._tempSettings = {};
  }

  getSetting<TKey extends keyof SettingTypeMap>(
    name: TKey,
  ): SettingValueTypeForKey<TKey> | undefined {
    // Allow changing settings for at least the session without cookies.
    if (this._tempSettings.hasOwnProperty(name)) {
      return this._tempSettings[name];
    }

    let value: SettingValueTypeForKey<TKey> | undefined;
    if (Cookies.enabled) {
      const val = Cookies.get(name);
      if (val === undefined) {
        if (name === $setting.symbolPaths) {
          value = (readLegacySymbolSources() ??
            _getSettingDefault(name)) as SettingValueTypeForKey<TKey>;
        } else {
          value = _getSettingDefault(name);
        }
      } else {
        value = JSON.parse(val) as SettingValueTypeForKey<TKey>;
        if (name === $setting.cCompiler) {
          value = parseCCompilerKind(value) as SettingValueTypeForKey<TKey>;
        }
        if (name === $setting.cOptLevel) {
          value = parseClangOptLevel(value) as SettingValueTypeForKey<TKey>;
        }
        if (name === $setting.symbolPaths) {
          value = parseExtraSymbolSources(
            value,
          ) as SettingValueTypeForKey<TKey>;
        }
      }
    } else {
      value = _getSettingDefault(name);
    }

    this._tempSettings[name] = value;
    return value;
  }

  setSetting<TKey extends keyof SettingTypeMap>(
    name: TKey,
    value: SettingValueTypeForKey<TKey>,
  ): void {
    this._tempSettings[name] = value;
    if (Cookies.enabled) {
      Cookies.set(name, JSON.stringify(value), { expires: Infinity });
      if (name === $setting.symbolPaths) {
        Cookies.expire("symbols.decomp");
        Cookies.expire("symbols.extra");
      }
    }

    this.listeners.forEach((callback) => {
      callback(name);
    });
  }

  reset() {
    this._tempSettings = {};

    if (Cookies.enabled) {
      _settings.forEach((setting) => {
        if (setting.type === "section") return;
        if (setting.id) Cookies.expire(setting.id);
      });
    }
  }
}
const _settingsManager = new SettingsManager();

setDebug(_settingsManager.getSetting($setting.uiDebug));
setCCompilerKind(_settingsManager.getSetting($setting.cCompiler));
setClangOptLevel(_settingsManager.getSetting($setting.cOptLevel));

function _getValue<TKey extends keyof SettingTypeMap>(
  id?: TKey,
): SettingValueTypeForKey<TKey> | undefined {
  if (id) return _settingsManager.getSetting(id);
  return undefined;
}

function _setValue<TKey extends keyof SettingTypeMap>(
  id: TKey,
  value: SettingValueTypeForKey<TKey>,
) {
  _settingsManager.setSetting(id, value);
  if (id === $setting.uiDebug) {
    setDebug(value as boolean);
  }
  if (id === $setting.cCompiler) {
    setCCompilerKind(value as CCompilerKind);
  }
  if (id === $setting.cOptLevel) {
    setClangOptLevel(value as ClangOptLevel);
  }
  if (id === $setting.symbolPaths) {
    reloadExtraSymbolsFromSettings();
  }
}

function readLegacySymbolSources(): IExtraSymbolSource[] | undefined {
  if (!Cookies.enabled) {
    return undefined;
  }
  const decomp = Cookies.get("symbols.decomp");
  const extra = Cookies.get("symbols.extra");
  if (decomp === undefined && extra === undefined) {
    return undefined;
  }
  let decompValue: unknown = [];
  let extraValue: unknown = [];
  try {
    if (decomp !== undefined) {
      decompValue = JSON.parse(decomp);
    }
    if (extra !== undefined) {
      extraValue = JSON.parse(extra);
    }
  } catch {
    return undefined;
  }
  return [
    ...parseExtraSymbolSources(decompValue),
    ...parseExtraSymbolSources(extraValue),
  ];
}

function collectExtraSymbolSources(): IExtraSymbolSource[] {
  return _settingsManager.getSetting($setting.symbolPaths) ?? [];
}

function reloadExtraSymbolsFromSettings(): void {
  void loadExtraSymbolSources(collectExtraSymbolSources());
}

reloadExtraSymbolsFromSettings();

function _getEffectiveSettings() {
  let settings = _settings;
  if (!_settingsManager.getSetting($setting.uiAdvanced)) {
    settings = settings.filter((setting) => {
      return !setting.advanced;
    });
  }
  return settings;
}

export const Settings = class Settings extends React.Component {
  state = {};

  render() {
    const formEls = _getEffectiveSettings().map((setting) => {
      switch (setting.type) {
        case "checkbox": {
          const value = _getValue(setting.id) as boolean | undefined;
          return (
            <CheckboxSetting
              id={setting.id!}
              name={setting.name}
              desc={setting.desc!}
              key={setting.id}
              value={value}
              onCheckChanged={(id, value) => this.onSettingChanged(id, value)}
            />
          );
        }
        case "section":
          return <h3 key={setting.name}>{setting.name}</h3>;
        case "theme": {
          const value = _getValue(setting.id) as EditorThemes;
          return (
            <ThemeSetting
              id={setting.id!}
              name={setting.name}
              key={setting.id}
              value={value}
              onThemeChanged={this.onSettingChanged}
            />
          );
        }
        case "ccompiler": {
          return (
            <CCompilerSetting
              name={setting.name}
              desc={setting.desc!}
              key={setting.id}
            />
          );
        }
        case "sympaths": {
          return (
            <SymbolPathsSetting
              id={$setting.symbolPaths}
              name={setting.name}
              desc={setting.desc!}
              key={setting.id}
            />
          );
        }
      }
      throw new Error("Unrecognized setting type");
    });
    return (
      <div id="settingsForm">
        <h2>Settings</h2>
        {formEls}
      </div>
    );
  }

  onSettingChanged = <TKey extends keyof SettingTypeMap>(
    id: TKey,
    value: SettingValueTypeForKey<TKey>,
  ) => {
    _setValue(id, value);
    this.forceUpdate(); // Trigger refresh
  };
};

interface CheckboxSettingProps<TKey extends keyof SettingTypeMap> {
  id: TKey;
  value: boolean | undefined;
  name: string;
  desc: string;
  onCheckChanged: (id: TKey, value: boolean) => any;
}

const CheckboxSetting = class CheckboxSetting extends React.Component<
  CheckboxSettingProps<keyof SettingTypeMap>
> {
  state = {};

  render() {
    const mainId = this.props.id + "-main";
    const descId = this.props.id + "-desc";
    return (
      <div className="checkboxSetting" onClick={this.onToggled}>
        <input
          type="checkbox"
          className="checkboxSettingChk"
          checked={this.props.value}
          onChange={this.onToggled}
          aria-labelledby={mainId}
          aria-describedby={descId}
        ></input>
        <div className="checkboxSettingLines">
          <span id={mainId} className="checkboxSettingMain">
            {this.props.name}
          </span>
          <br />
          <span id={descId} className="checkboxSettingDesc">
            {this.props.desc}
          </span>
        </div>
      </div>
    );
  }

  onToggled = () => {
    this.props.onCheckChanged(this.props.id, !this.props.value);
  };
};

interface IThemeSettingProps {
  name: string;
  id: string;
  value: EditorThemes | undefined;
  onThemeChanged(id: string, value: EditorThemes): void;
}

function ThemeSetting(props: IThemeSettingProps) {
  return (
    <div className="themeSetting">
      <ThemeOption
        name="Classic"
        theme={EditorThemes.Classic}
        accentColorHexString="#5A4540"
        selected={props.value === EditorThemes.Classic || !props.value}
        onSelected={(theme) => props.onThemeChanged(props.id, theme)}
      />
      <ThemeOption
        name="Dark Gray"
        theme={EditorThemes.DarkGray}
        accentColorHexString="#4a4a4a"
        selected={props.value === EditorThemes.DarkGray}
        onSelected={(theme) => props.onThemeChanged(props.id, theme)}
      />
    </div>
  );
}

interface IThemeOptionProps<TTheme extends EditorThemes> {
  name: string;
  theme: TTheme;
  accentColorHexString: `#${string}`;
  selected: boolean;
  onSelected(value: TTheme): void;
}

function ThemeOption(props: IThemeOptionProps<EditorThemes>) {
  return (
    <ToggleButton
      id={props.theme}
      key={props.theme}
      allowDeselect={false}
      onToggled={() => props.onSelected(props.theme)}
      pressed={props.selected}
    >
      <span
        className="themeColorSwatch"
        title={props.name}
        style={{ backgroundColor: props.accentColorHexString }}
      ></span>
    </ToggleButton>
  );
}

interface ICCompilerSettingProps {
  name: string;
  desc: string;
}

function CCompilerSetting(props: ICCompilerSettingProps) {
  return (
    <div className="cCompilerSetting">
      <div className="cCompilerSettingLines">
        <span className="cCompilerSettingMain">{props.name}</span>
        <br />
        <span className="cCompilerSettingDesc">{props.desc}</span>
      </div>
      <CCompilerControls />
    </div>
  );
}

/** Shared SmallerC / Clang switch used by Settings and the C event editor. */
export function CCompilerToggle() {
  return <CCompilerControls />;
}

function CCompilerControls() {
  const [value, setValue] = React.useState(
    () =>
      _settingsManager.getSetting($setting.cCompiler) ?? CCompilerKind.Clang,
  );
  const [optLevel, setOptLevel] = React.useState<ClangOptLevel>(() =>
    parseClangOptLevel(_settingsManager.getSetting($setting.cOptLevel)),
  );

  React.useEffect(() => {
    const listener: SettingChangedListener = (id) => {
      if (id === $setting.cCompiler) {
        setValue(
          _settingsManager.getSetting($setting.cCompiler) ??
            CCompilerKind.Clang,
        );
      }
      if (id === $setting.cOptLevel) {
        setOptLevel(
          parseClangOptLevel(_settingsManager.getSetting($setting.cOptLevel)),
        );
      }
    };
    addSettingChangedListener(listener);
    return () => removeSettingChangedListener(listener);
  }, []);

  return (
    <div className="cCompilerControls">
      <div className="cCompilerToggle">
        <ToggleButton
          id={CCompilerKind.Clang}
          allowDeselect={false}
          pressed={value === CCompilerKind.Clang}
          title="Default C compiler for event scripts"
          onToggled={() => _setValue($setting.cCompiler, CCompilerKind.Clang)}
        >
          Clang
        </ToggleButton>
        <ToggleButton
          id={CCompilerKind.SmallerC}
          allowDeselect={false}
          pressed={value === CCompilerKind.SmallerC}
          title="Legacy SmallerC compiler. Use only for older event scripts."
          onToggled={() =>
            _setValue($setting.cCompiler, CCompilerKind.SmallerC)
          }
        >
          SmallerC (legacy)
        </ToggleButton>
      </div>
      <label className="cCompilerOptLevel">
        <span>Opt</span>
        <select
          value={optLevel}
          disabled={value !== CCompilerKind.Clang}
          title="Clang optimization level"
          onChange={(e) =>
            _setValue($setting.cOptLevel, parseClangOptLevel(e.target.value))
          }
        >
          {CLANG_OPT_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function usaVersionLabel(game: Game | undefined): string {
  switch (game) {
    case Game.MP1_USA:
      return "MP1";
    case Game.MP2_USA:
      return "MP2";
    case Game.MP3_USA:
      return "MP3";
    default:
      return "";
  }
}

interface ISymbolPathsSettingProps {
  id: $setting.symbolPaths;
  name: string;
  desc: string;
}

function SymbolPathsSetting(props: ISymbolPathsSettingProps) {
  const [pathText, setPathText] = React.useState("");
  const [error, setError] = React.useState("");
  const [, bump] = React.useState(0);

  React.useEffect(() => {
    return addExtraSymbolListener(() => bump((n: number) => n + 1));
  }, []);

  const sources = (_getValue(props.id) ?? []) as IExtraSymbolSource[];
  const statuses = getExtraSymbolStatuses();
  const statusById = new Map(statuses.map((status) => [status.id, status]));

  function commit(next: IExtraSymbolSource[]) {
    _setValue(props.id, next);
    setError("");
    bump((n: number) => n + 1);
  }

  function addPath(path: string, inline?: { id: string; contents: string }) {
    const trimmed = path.trim();
    if (!trimmed) {
      setError("Enter a symbol file URL or path first.");
      return;
    }
    const resolvedGame = inferGameFromSymbolPath(trimmed);
    if (!resolvedGame) {
      setError(
        "Could not tell which game this file is for. Use a marioparty3 URL or MarioParty3U.sym filename.",
      );
      return;
    }
    const id = inline?.id ?? createExtraSymbolSourceId();
    if (inline) {
      writeInlineSymbolFile(id, inline.contents);
    }
    commit([
      ...sources,
      {
        id,
        path: trimmed,
        game: resolvedGame,
        inline: !!inline,
      },
    ]);
    setPathText("");
  }

  function removeSource(source: IExtraSymbolSource) {
    if (source.inline) {
      removeInlineSymbolFile(source.id);
    }
    commit(sources.filter((entry) => entry.id !== source.id));
  }

  function addLocalFile() {
    openFile(".sym,.csv,.txt,text/plain", (event: Event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files && input.files[0];
      if (!file) {
        return;
      }
      void file.text().then((contents) => {
        const parsed = parseSymFile(contents);
        if (!parsed.length) {
          setError(
            "That file did not look like a .sym CSV or splat symbol_addrs.txt list.",
          );
          return;
        }
        addPath(file.name, {
          id: createExtraSymbolSourceId(),
          contents,
        });
      });
    });
  }

  return (
    <div className="symbolPathsSetting">
      <div className="symbolPathsSettingLines">
        <span className="symbolPathsSettingMain">{props.name}</span>
        <br />
        <span className="symbolPathsSettingDesc">{props.desc}</span>
      </div>
      {sources.length > 0 && (
        <ul className="symbolPathsList">
          {sources.map((source) => {
            const status = statusById.get(source.id);
            const version = usaVersionLabel(
              status?.game ??
                source.game ??
                inferGameFromSymbolPath(source.path),
            );
            return (
              <li className="symbolPathsRow" key={source.id}>
                {version && (
                  <span className="symbolPathsVersion">{version}</span>
                )}
                <div className="symbolPathsRowPath" title={source.path}>
                  {source.path}
                </div>
                <span
                  className={
                    "symbolPathsStatus" +
                    (status?.state === "error" ? " symbolPathsStatusError" : "")
                  }
                >
                  {status?.state === "loading" && "Loading…"}
                  {status?.state === "ok" && `${status.count ?? 0} symbols`}
                  {status?.state === "error" && (status.error || "Failed")}
                </span>
                <Button
                  css="symbolPathsRemove"
                  title="Remove this symbol file"
                  onClick={() => removeSource(source)}
                >
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="symbolPathsAdd">
        <input
          className="symbolPathsInput"
          type="text"
          spellCheck={false}
          placeholder="https://github.com/mariopartyrd/marioparty3/blob/main/symbol_addrs.txt"
          value={pathText}
          onChange={(e) => setPathText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addPath(pathText);
            }
          }}
          aria-label={`Add ${props.name} path`}
        />
        <Button onClick={() => addPath(pathText)}>Add URL</Button>
        <Button onClick={addLocalFile}>Add file</Button>
      </div>
      {error && <div className="symbolPathsError">{error}</div>}
    </div>
  );
}

export function get<TKey extends keyof SettingTypeMap>(
  id: TKey,
): SettingValueTypeForKey<TKey> | undefined {
  return _settingsManager.getSetting(id);
}
export function set<TKey extends keyof SettingTypeMap>(
  id: TKey,
  value: SettingValueTypeForKey<TKey>,
): void {
  return _settingsManager.setSetting(id, value);
}

interface SettingChangedListener {
  (id: keyof SettingTypeMap): void;
}

/** Adds a callback that will be raised when a setting changes. */
export function addSettingChangedListener(
  callback: SettingChangedListener,
): void {
  _settingsManager.listeners.add(callback);
}

/** Removes a callback added by addSettingChangedListener. */
export function removeSettingChangedListener(
  callback: SettingChangedListener,
): void {
  _settingsManager.listeners.delete(callback);
}
