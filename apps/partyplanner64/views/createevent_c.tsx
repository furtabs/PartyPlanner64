import * as React from "react";
import {
  updateCreateEventViewInstance,
  ICreateEventView,
  EventDetailsForm,
} from "./createevent_shared";
import {
  Game,
  EventExecutionType,
  getExecutionTypeName,
  getGameName,
  EventCodeLanguage,
} from "../../../packages/lib/types";
import {
  ICustomEvent,
  CustomAsmHelper,
  validateCustomEvent,
  createCustomEvent,
} from "../../../packages/lib/events/customevents";
import {
  DEFAULT_ENTRY_FILE,
  EventProjectFolder,
  IEventProjectFiles,
  cloneEventProject,
  createDefaultCProject,
  getEntrySource,
  normalizeEventProject,
  projectFilesEqual,
} from "../../../packages/lib/events/eventproject";
import { CodeMirrorWrapper } from "../components/codemirrorwrapper";
import {
  EventFileExplorer,
  IActiveProjectFile,
} from "../components/EventFileExplorer";
import { IEventParameter } from "../../../packages/lib/events/events";
import { getCurrentEvent, confirmFromUser, showMessage } from "../appControl";
import { TabStrip, Tab } from "../components/tabstrip";

const _defaultEventC = `// NAME:
// GAMES:
// EXECUTION: Direct

#include "ultra64.h"
// Headers in include/ are available via #include "file.h"

void main() {
    // Your code here!
    // For code examples, see:
    // https://github.com/PartyPlanner64/events
}`;

interface ICreateEventViewState {
  eventName: string;
  supportedGames: Game[];
  executionType: EventExecutionType;
  files: IEventProjectFiles;
  activeFile: IActiveProjectFile;
  parameters: IEventParameter[];
  hasError?: boolean;
  originalFiles?: IEventProjectFiles;
  compiledAsm: string | null;
  activeCodeTabIndex: number;
}

function getFileContent(
  files: IEventProjectFiles,
  file: IActiveProjectFile,
): string {
  return files[file.folder][file.name] ?? "";
}

function setFileContent(
  files: IEventProjectFiles,
  file: IActiveProjectFile,
  content: string,
): IEventProjectFiles {
  const next = cloneEventProject(files);
  next[file.folder][file.name] = content;
  return next;
}

export class CreateCEventView
  extends React.Component<{}, ICreateEventViewState>
  implements ICreateEventView
{
  constructor(props: {}) {
    super(props);

    const currentEvent = getCurrentEvent() as ICustomEvent;
    if (currentEvent) {
      const files = normalizeEventProject(currentEvent.asm, currentEvent.files);
      this.state = {
        eventName: currentEvent.name,
        supportedGames: currentEvent.supportedGames,
        executionType: currentEvent.executionType,
        files,
        activeFile: { folder: "src", name: DEFAULT_ENTRY_FILE },
        parameters: currentEvent.parameters!,
        originalFiles: cloneEventProject(files),
        compiledAsm: null,
        activeCodeTabIndex: 0,
      };
    } else {
      const files = createDefaultCProject(_defaultEventC);
      this.state = {
        eventName: "",
        supportedGames: [],
        executionType: EventExecutionType.DIRECT,
        files,
        activeFile: { folder: "src", name: DEFAULT_ENTRY_FILE },
        parameters: [],
        compiledAsm: null,
        activeCodeTabIndex: 0,
      };
    }
  }

  render() {
    if (this.state.hasError) {
      return <p>An error was encountered.</p>;
    }

    const activeContent = getFileContent(this.state.files, this.state.activeFile);
    const isEntryFile =
      this.state.activeFile.folder === "src" &&
      this.state.activeFile.name === DEFAULT_ENTRY_FILE;
    const showingCompiledAsm =
      isEntryFile && this.state.activeCodeTabIndex === 1;
    const activePath = showingCompiledAsm
      ? "MIPS Assembly (compiled from src/main.c)"
      : `${this.state.activeFile.folder}/${this.state.activeFile.name}`;

    return (
      <div className="createEventViewContainer createEventIdeLayout">
        <div className="createEventIdePane">
          <EventFileExplorer
            files={this.state.files}
            activeFile={this.state.activeFile}
            onSelectFile={this.onSelectFile}
            onAddFile={this.onAddFile}
            onDeleteFile={this.onDeleteFile}
          />
          <div className="createEventEditorColumn">
            <div className="createEventOpenFilePath">{activePath}</div>
            <TabStrip
              activeTabIndex={isEntryFile ? this.state.activeCodeTabIndex : 0}
              className="createEventTabStrip"
              contentClassName="createEventTabStripContent"
              tabsClassName="createEventTabStripTabs"
              onActiveTabChanged={this.onActiveTabChanged}
            >
              <Tab caption="C Source" className="createEventTabStripTab">
                <CodeMirrorWrapper
                  key={activePath}
                  mode="c"
                  className="eventcodemirror createeventcodemirror"
                  value={activeContent}
                  onChange={this.onCodeChange}
                />
              </Tab>
              {isEntryFile && (
                <Tab caption="MIPS Assembly" className="createEventTabStripTab">
                  <CodeMirrorWrapper
                    key="mips"
                    mode="mips-pp64"
                    className="eventcodemirror createeventcodemirror"
                    value={this.state.compiledAsm || undefined}
                    readOnly
                  />
                </Tab>
              )}
            </TabStrip>
          </div>
        </div>
        <EventDetailsForm
          name={this.state.eventName}
          onEventNameChange={this.onEventNameChange}
          supportedGames={this.state.supportedGames}
          onGameToggleClicked={this.onGameToggleClicked}
          executionType={this.state.executionType}
          onExecTypeToggleClicked={this.onExecTypeToggleClicked}
          language={EventCodeLanguage.C}
          parameters={this.state.parameters}
          onAddEventParameter={this.onAddEventParameter}
          onRemoveEventParameter={this.onRemoveEventParameter}
        />
      </div>
    );
  }

  componentDidMount() {
    updateCreateEventViewInstance(this);
  }

  componentWillUnmount() {
    updateCreateEventViewInstance(null);
  }

  onSelectFile = (file: IActiveProjectFile) => {
    this.setState({
      activeFile: file,
      activeCodeTabIndex: 0,
      compiledAsm: null,
    });
  };

  onAddFile = (folder: EventProjectFolder, name: string) => {
    const files = cloneEventProject(this.state.files);
    files[folder][name] = `// ${name}\n\n`;
    this.setState({
      files,
      activeFile: { folder, name },
      activeCodeTabIndex: 0,
      compiledAsm: null,
    });
  };

  onDeleteFile = (folder: EventProjectFolder, name: string) => {
    if (folder === "src" && name === DEFAULT_ENTRY_FILE) return;
    const files = cloneEventProject(this.state.files);
    delete files[folder][name];

    let activeFile = this.state.activeFile;
    if (activeFile.folder === folder && activeFile.name === name) {
      activeFile = { folder: "src", name: DEFAULT_ENTRY_FILE };
    }
    this.setState({ files, activeFile, activeCodeTabIndex: 0, compiledAsm: null });
  };

  onEventNameChange = (eventName: string) => {
    const newState = { ...this.state, eventName };
    this.setState({ eventName });
    this.syncTextToStateVars(newState, getEntrySource(this.state.files));
  };

  onCodeChange = (code: string) => {
    const files = setFileContent(this.state.files, this.state.activeFile, code);
    this.setState({ files });
    if (
      this.state.activeFile.folder === "src" &&
      this.state.activeFile.name === DEFAULT_ENTRY_FILE
    ) {
      this.syncStateVarsToText(code);
    }
  };

  updateLastSavedCode(code: string) {
    // Keep signature for shared interface; prefer full project snapshot.
    const files = setFileContent(
      this.state.files,
      { folder: "src", name: DEFAULT_ENTRY_FILE },
      code,
    );
    this.setState({
      files,
      originalFiles: cloneEventProject(files),
    });
  }

  updateLastSavedFiles(files: IEventProjectFiles) {
    this.setState({ originalFiles: cloneEventProject(files) });
  }

  onGameToggleClicked = (id: any, pressed: boolean) => {
    const supportedGames = this.state.supportedGames;
    const gameIndex = supportedGames.indexOf(id);

    let newState;
    if (gameIndex === -1 && pressed) {
      this.setState({
        supportedGames: [...supportedGames, id],
      });
      newState = { ...this.state };
      newState.supportedGames = [...supportedGames, id];
    } else if (gameIndex >= 0 && !pressed) {
      supportedGames.splice(gameIndex, 1);
      this.setState({
        supportedGames: supportedGames,
      });
      newState = { ...this.state };
      newState.supportedGames = supportedGames;
    }

    if (newState) {
      this.syncTextToStateVars(newState, getEntrySource(this.state.files));
    }
  };

  onExecTypeToggleClicked = (id: any, pressed: boolean) => {
    const newState = { ...this.state };
    newState.executionType = id;
    this.setState({ executionType: id });
    this.syncTextToStateVars(newState, getEntrySource(this.state.files));
  };

  onAddEventParameter = (entry: IEventParameter) => {
    const newState = { ...this.state };
    newState.parameters = [...this.state.parameters, entry];
    this.setState(newState);
    this.syncTextToStateVars(newState, getEntrySource(this.state.files));
  };

  onRemoveEventParameter = (removedEntry: IEventParameter) => {
    const newState = { ...this.state };
    newState.parameters = this.state.parameters.filter((entry) => {
      return entry.name !== removedEntry.name;
    });
    this.setState(newState);
    this.syncTextToStateVars(newState, getEntrySource(this.state.files));
  };

  getEventName = () => {
    return this.state.eventName;
  };

  getSupportedGames = () => {
    return this.state.supportedGames;
  };

  getEventCode = () => {
    return getEntrySource(this.state.files);
  };

  getEventFiles = () => {
    return cloneEventProject(this.state.files);
  };

  getLanguage(): EventCodeLanguage {
    return EventCodeLanguage.C;
  }

  /** Ensures the entry file includes the discrete properties. */
  syncTextToStateVars = (
    newState: ICreateEventViewState,
    existingCode: string,
  ) => {
    let newCode = __clearDiscreteProperties(existingCode, [
      "NAME",
      "GAMES",
      "EXECUTION",
      "PARAM",
    ]);
    newCode = "\n" + newCode;
    newCode = __writeDiscretePropertyArray(
      newCode,
      "PARAM",
      newState.parameters.map((param) => {
        return `${param.type}|${param.name}`;
      }),
    );
    newCode = __writeDiscreteProperty(
      newCode,
      "EXECUTION",
      getExecutionTypeName(newState.executionType),
    );
    newCode = __writeDiscreteProperty(
      newCode,
      "GAMES",
      newState.supportedGames.map(getGameName).join(","),
    );
    newCode = __writeDiscreteProperty(
      newCode,
      "NAME",
      newState.eventName.trim(),
    );

    if (newCode !== existingCode) {
      const files = setFileContent(
        this.state.files,
        { folder: "src", name: DEFAULT_ENTRY_FILE },
        newCode,
      );
      this.setState({ files });
    }
  };

  /** Pulls out discrete properties from the entry file back into state. */
  syncStateVarsToText = (code: string) => {
    let value: any = __readDiscreteProperty(code, "NAME");
    if (value !== null) {
      this.setState({ eventName: (value || "").trim() });
    }

    value = CustomAsmHelper.readSupportedGames(code);
    if (value !== null) {
      this.setState({ supportedGames: value });
    }

    value = CustomAsmHelper.readExecutionType(code);
    if (value) {
      this.setState({ executionType: value });
    }

    value = CustomAsmHelper.readParameters(code);
    if (value) {
      this.setState({ parameters: value });
    }
  };

  promptExit = async () => {
    const files = this.state.files;
    const oldFiles = this.state.originalFiles;
    if (!oldFiles || !projectFilesEqual(oldFiles, files)) {
      return await confirmFromUser(
        "Are you sure you want to exit without saving the event?",
      );
    }
    return true;
  };

  onActiveTabChanged = async (index: number) => {
    switch (index) {
      case 0: // C Source
        this.setState({
          activeCodeTabIndex: 0,
          compiledAsm: null,
        });
        break;

      case 1: // MIPS
        {
          if (!this.getEventName()) {
            showMessage("The event name is missing.");
            return;
          }
          if (!this.getSupportedGames().length) {
            showMessage("At least one game must be supported.");
            return;
          }

          let asm: string;
          const code = this.getEventCode();
          const files = this.getEventFiles();
          const event = createCustomEvent(EventCodeLanguage.C, code, files);
          try {
            await validateCustomEvent(event);
          } catch (e: any) {
            showMessage(e.toString());
          }
          try {
            asm = (await CustomAsmHelper.testCustomEvent(
              EventCodeLanguage.C,
              code,
              this.state.parameters,
              {
                game: event.supportedGames[0], // Pick one game randomly I guess
              },
              files,
            )) as string;
          } catch (e: any) {
            showMessage(e.toString());
            return;
          }

          this.setState({
            activeCodeTabIndex: 1,
            compiledAsm: asm,
          });
        }
        break;
    }
  };
}

function __clearDiscreteProperties(code: string, properties: string[]) {
  return CustomAsmHelper.clearDiscreteProperties(code, properties);
}

function __writeDiscreteProperty(
  code: string,
  propName: string,
  value: string,
) {
  return CustomAsmHelper.writeDiscreteProperty(code, propName, value, "//");
}

function __writeDiscretePropertyArray(
  code: string,
  propName: string,
  values: string[],
) {
  return CustomAsmHelper.writeDiscretePropertyArray(
    code,
    propName,
    values,
    "//",
  );
}

function __readDiscreteProperty(code: string, propName: string) {
  return CustomAsmHelper.readDiscreteProperty(code, propName);
}
