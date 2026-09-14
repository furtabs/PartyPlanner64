import * as React from "react";
import {
  DEFAULT_ENTRY_FILE,
  EventProjectFolder,
  IEventProjectFiles,
  isValidProjectFileName,
  listProjectFiles,
  suggestProjectFileName,
} from "../../../packages/lib/events/eventproject";

export interface IActiveProjectFile {
  folder: EventProjectFolder;
  name: string;
}

interface IEventFileExplorerProps {
  files: IEventProjectFiles;
  activeFile: IActiveProjectFile;
  onSelectFile(file: IActiveProjectFile): void;
  onAddFile(folder: EventProjectFolder, name: string): void;
  onDeleteFile(folder: EventProjectFolder, name: string): void;
}

export class EventFileExplorer extends React.Component<IEventFileExplorerProps> {
  render() {
    return (
      <div className="eventFileExplorer">
        <div className="eventFileExplorerHeader">Files</div>
        <div className="eventFileExplorerTree">
          <FolderNode
            folder="src"
            label="src"
            files={this.props.files}
            activeFile={this.props.activeFile}
            onSelectFile={this.props.onSelectFile}
            onAddFile={this.props.onAddFile}
            onDeleteFile={this.props.onDeleteFile}
          />
          <FolderNode
            folder="include"
            label="include"
            files={this.props.files}
            activeFile={this.props.activeFile}
            onSelectFile={this.props.onSelectFile}
            onAddFile={this.props.onAddFile}
            onDeleteFile={this.props.onDeleteFile}
          />
        </div>
        <div className="eventFileExplorerHint">
          <code>#include</code> resolves from <code>include/</code> and{" "}
          <code>src/</code>
        </div>
      </div>
    );
  }
}

interface IFolderNodeProps {
  folder: EventProjectFolder;
  label: string;
  files: IEventProjectFiles;
  activeFile: IActiveProjectFile;
  onSelectFile(file: IActiveProjectFile): void;
  onAddFile(folder: EventProjectFolder, name: string): void;
  onDeleteFile(folder: EventProjectFolder, name: string): void;
}

class FolderNode extends React.Component<IFolderNodeProps> {
  state = { expanded: true };

  toggleExpanded = () => {
    this.setState({ expanded: !this.state.expanded });
  };

  onAddClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const existing = this.props.files[this.props.folder];
    const suggested = suggestProjectFileName(this.props.folder, existing);
    const name = window.prompt("New file name:", suggested);
    if (!name) return;
    const trimmed = name.trim();
    if (!isValidProjectFileName(trimmed)) {
      window.alert(
        "File name must look like name.c or name.h (letters, numbers, _ . -).",
      );
      return;
    }
    if (existing[trimmed] != null) {
      window.alert(`File ${trimmed} already exists.`);
      return;
    }
    this.props.onAddFile(this.props.folder, trimmed);
  };

  render() {
    const names = listProjectFiles(this.props.files, this.props.folder);
    return (
      <div className="eventFileFolder">
        <div className="eventFileFolderRow" onClick={this.toggleExpanded}>
          <span className="eventFileTwisty">
            {this.state.expanded ? "▾" : "▸"}
          </span>
          <span className="eventFileFolderLabel">{this.props.label}/</span>
          <button
            type="button"
            className="eventFileAddBtn"
            title={`Add file to ${this.props.label}/`}
            onClick={this.onAddClick}
          >
            +
          </button>
        </div>
        {this.state.expanded && (
          <div className="eventFileChildren">
            {names.length === 0 && (
              <div className="eventFileEmpty">No files</div>
            )}
            {names.map((name) => {
              const active =
                this.props.activeFile.folder === this.props.folder &&
                this.props.activeFile.name === name;
              const canDelete = !(
                this.props.folder === "src" && name === DEFAULT_ENTRY_FILE
              );
              return (
                <div
                  key={name}
                  className={
                    "eventFileRow" + (active ? " eventFileRowActive" : "")
                  }
                  onClick={() =>
                    this.props.onSelectFile({
                      folder: this.props.folder,
                      name,
                    })
                  }
                >
                  <span className="eventFileIcon">
                    {name.endsWith(".h") ? "H" : "C"}
                  </span>
                  <span className="eventFileName" title={name}>
                    {name}
                  </span>
                  {canDelete && (
                    <button
                      type="button"
                      className="eventFileDeleteBtn"
                      title={`Delete ${name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (
                          window.confirm(`Delete ${this.props.folder}/${name}?`)
                        ) {
                          this.props.onDeleteFile(this.props.folder, name);
                        }
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }
}
