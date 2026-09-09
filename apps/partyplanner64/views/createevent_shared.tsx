import * as React from "react";

import { showMessage, getCurrentEventIsBoardEvent } from "../appControl";
import { includeEventInBoard } from "../boards";
import {
  getEventFromLibrary,
  addEventToLibrary,
} from "../../../packages/lib/events/EventLibrary";
import {
  createCustomEvent,
  validateCustomEvent,
} from "../../../packages/lib/events/customevents";
import {
  Game,
  EventExecutionType,
  EventParameterType,
  EventCodeLanguage,
} from "../../../packages/lib/types";
import { CustomAsmHelper } from "../../../packages/lib/events/customevents";
import { IEventParameter } from "../../../packages/lib/events/events";
import { ToggleGroup, Button, ToggleButton } from "../controls";
import { CCompilerToggle } from "./settings";

import deleteImage from "../img/events/delete.png";

import "../css/createevent.scss";

export interface ICreateEventView {
  getEventName(): string;
  getSupportedGames(): Game[];
  getEventCode(): string;
  getLanguage(): EventCodeLanguage;
  updateLastSavedCode(code: string): void;
  promptExit(): Promise<boolean>;
}

let _createEventViewInstance: ICreateEventView | null = null;

export function updateCreateEventViewInstance(
  instance: ICreateEventView | null,
): void {
  _createEventViewInstance = instance;
}

export async function saveEvent(): Promise<void> {
  const eventName = _createEventViewInstance!.getEventName();
  const supportedGames = _createEventViewInstance!.getSupportedGames();
  const code = _createEventViewInstance!.getEventCode();

  if (!eventName) {
    showMessage("An event name must be specified.");
    return;
  }

  const existingEvent = getEventFromLibrary(eventName);
  if (existingEvent && !existingEvent.custom) {
    showMessage(
      "The event name collides with a reserved event name from the original boards.",
    );
    return;
  }

  if (!supportedGames.length) {
    showMessage("At least one game must be supported.");
    return;
  }
  if (!code) {
    showMessage("No assembly code was provided.");
    return;
  }

  const language = _createEventViewInstance!.getLanguage();
  const event = createCustomEvent(language, code);
  try {
    await validateCustomEvent(event);
  } catch (e: any) {
    showMessage(e.toString());
  }

  if (getCurrentEventIsBoardEvent()) {
    includeEventInBoard(event);
  } else {
    addEventToLibrary(event); // Add globally.
  }

  if (_createEventViewInstance) {
    // Ensure we don't prompt for unsaved changes.
    _createEventViewInstance.updateLastSavedCode(code);
  }
}

export function createEventPromptExit(): Promise<boolean> {
  if (_createEventViewInstance) {
    return _createEventViewInstance.promptExit();
  }
  return Promise.resolve(true);
}

/**
 * Get the supported games for the event currently being edited.
 */
export function getActiveEditorSupportedGames(): Game[] {
  if (_createEventViewInstance) {
    return _createEventViewInstance.getSupportedGames();
  }
  return [];
}

interface IEventDetailsFormProps {
  name: string;
  supportedGames: Game[];
  executionType: EventExecutionType;
  language: EventCodeLanguage;
  parameters: IEventParameter[];
  onGameToggleClicked(id: any, pressed: boolean): any;
  onExecTypeToggleClicked(id: any, pressed: boolean): any;
  onAddEventParameter(parameter: IEventParameter): any;
  onRemoveEventParameter(parameter: IEventParameter): any;
  onEventNameChange(name: string): any;
}

export class EventDetailsForm extends React.Component<IEventDetailsFormProps> {
  render() {
    const gameToggles = [
      {
        id: Game.MP1_USA,
        text: "MP1 USA",
        selected: this._gameSupported(Game.MP1_USA),
      },
      {
        id: Game.MP2_USA,
        text: "MP2 USA",
        selected: this._gameSupported(Game.MP2_USA),
      },
      {
        id: Game.MP3_USA,
        text: "MP3 USA",
        selected: this._gameSupported(Game.MP3_USA),
      },
      {
        id: Game.MP1_JPN,
        text: "MP1 JPN",
        selected: this._gameSupported(Game.MP1_JPN),
      },
      {
        id: Game.MP2_JPN,
        text: "MP2 JPN",
        selected: this._gameSupported(Game.MP2_JPN),
      },
      {
        id: Game.MP3_JPN,
        text: "MP3 JPN",
        selected: this._gameSupported(Game.MP3_JPN),
      },
      {
        id: Game.MP1_PAL,
        text: "MP1 PAL",
        selected: this._gameSupported(Game.MP1_PAL),
      },
      {
        id: Game.MP2_PAL,
        text: "MP2 PAL",
        selected: this._gameSupported(Game.MP2_PAL),
      },
      {
        id: Game.MP3_PAL,
        text: "MP3 PAL",
        selected: this._gameSupported(Game.MP3_PAL),
      },
    ];

    const execTypeToggles = [
      {
        id: 1,
        text: "Direct",
        title: "The game will execute the event function directly",
        selected: this.props.executionType === EventExecutionType.DIRECT,
      },
      {
        id: 2,
        text: "Process",
        title:
          "The game will use its process system when executing the event function",
        selected: this.props.executionType === EventExecutionType.PROCESS,
      },
    ];

    return (
      <div className="createEventForm">
        <label>Name:</label>
        <input value={this.props.name} onChange={this.onEventNameChange} />
        <br />
        <br />
        <label>Supported Games:</label>
        <ToggleGroup
          items={gameToggles}
          groupCssClass="createEventGameToggles"
          onToggleClick={this.props.onGameToggleClicked}
        />
        <br />
        <label>Execution Type:</label>
        <ToggleGroup
          items={execTypeToggles}
          allowDeselect={false}
          onToggleClick={this.props.onExecTypeToggleClicked}
        />
        {this.props.language === EventCodeLanguage.C && (
          <>
            <br />
            <label>C Compiler:</label>
            <CCompilerToggle />
            <div className="cCompilerLegacyHint">
              Clang is the default. SmallerC is only for legacy scripts.
            </div>
          </>
        )}
        <br />
        <label>Parameters:</label>
        <EventParametersList
          language={this.props.language}
          parameters={this.props.parameters}
          onAddEventParameter={this.props.onAddEventParameter}
          onRemoveEventParameter={this.props.onRemoveEventParameter}
        />
      </div>
    );
  }

  onEventNameChange = (event: any) => {
    this.props.onEventNameChange(event.target.value);
  };

  _gameSupported = (game: Game) => {
    return this.props.supportedGames.indexOf(game) >= 0;
  };
}

interface IEventParametersListProps {
  language: EventCodeLanguage;
  parameters: IEventParameter[];
  onAddEventParameter(entry: IEventParameter): any;
  onRemoveEventParameter(entry: IEventParameter): any;
}

class EventParametersList extends React.Component<IEventParametersListProps> {
  render() {
    const entries = this.props.parameters.map((entry) => {
      return (
        <EventParametersEntry
          entry={entry}
          key={entry.name}
          onRemoveEntry={this.props.onRemoveEventParameter}
        />
      );
    });

    return (
      <div className="eventParametersList">
        <table>
          <tbody>{entries}</tbody>
        </table>
        <EventParametersAddNewEntry
          language={this.props.language}
          onAddEntry={this.props.onAddEventParameter}
        />
      </div>
    );
  }
}

interface IEventParametersEntryProps {
  entry: IEventParameter;
  onRemoveEntry(entry: IEventParameter): any;
}

class EventParametersEntry extends React.Component<IEventParametersEntryProps> {
  render() {
    const { type, name } = this.props.entry;

    return (
      <tr className="eventParameterEntry">
        <td className="eventParameterEntryType">{type}</td>
        <td className="eventParameterEntryName" title={name}>
          {name}
        </td>
        <td className="eventParameterEntryDelete">
          <img
            src={deleteImage}
            alt="Delete"
            onClick={this.onDeleteClick}
          ></img>
        </td>
      </tr>
    );
  }

  onDeleteClick = () => {
    this.props.onRemoveEntry(this.props.entry);
  };
}

interface IEventParametersAddNewEntryProps {
  language: EventCodeLanguage;
  onAddEntry(entry: IEventParameter): any;
}

class EventParametersAddNewEntry extends React.Component<IEventParametersAddNewEntryProps> {
  state = {
    selectedType: "",
    name: "",
  };

  render() {
    return (
      <div className="eventParameterAddNewEntry">
        <select value={this.state.selectedType} onChange={this.onTypeChange}>
          <option></option>
          <option value={EventParameterType.Boolean}>Boolean</option>
          <option value={EventParameterType.Number}>Number</option>
          <option value={EventParameterType.PositiveNumber}>
            Positive Number
          </option>
          <option value={EventParameterType.Space}>Space</option>
          <option value={EventParameterType.SpaceArray}>Space Array</option>
        </select>
        <input
          type="text"
          placeholder="Name"
          value={this.state.name}
          onChange={this.onNameChange}
        />
        <Button onClick={this.onAddClick}>Add</Button>
      </div>
    );
  }

  onNameChange = (event: any) => {
    const newName = event.target.value;

    // Can only contain valid characters for a assembler label
    if (!newName.match(CustomAsmHelper.validParameterNameRegex)) return;

    this.setState({ name: newName });
  };

  onTypeChange = (event: any) => {
    this.setState({ selectedType: event.target.value });
  };

  onAddClick = () => {
    if (!this.state.name || !this.state.selectedType) return;

    this.props.onAddEntry({
      name: this.state.name,
      type: this.state.selectedType as EventParameterType,
    });
    this.setState({
      name: "",
      selectedType: "",
    });
  };
}

interface INewEventDropdownProps {
  onAccept(language: EventCodeLanguage): void;
}

export class NewEventDropdown extends React.Component<INewEventDropdownProps> {
  state = {
    language: EventCodeLanguage.C,
  };

  onLanguageChange = (language: EventCodeLanguage) => {
    this.setState({ language });
  };

  submit = () => {
    let fn = this.props.onAccept;
    if (fn) fn(this.state.language);
  };

  render() {
    return (
      <div className="createEventDropdownContainer">
        <NewEventLanguageSelect
          language={this.state.language}
          onLanguageChange={this.onLanguageChange}
        />
        <Button onClick={this.submit} css="nbCreate">
          Create
        </Button>
      </div>
    );
  }
}

interface INewEventLanguageSelect {
  language: EventCodeLanguage;
  onLanguageChange(language: EventCodeLanguage): void;
}

class NewEventLanguageSelect extends React.Component<INewEventLanguageSelect> {
  onLanguageChange = (language: EventCodeLanguage) => {
    this.props.onLanguageChange(language);
  };

  render() {
    return (
      <div className="newBoardVersionSelect">
        <label className="nbLabel">Code Language</label>
        <br />
        <ToggleButton
          id={EventCodeLanguage.C}
          allowDeselect={false}
          onToggled={this.onLanguageChange}
          pressed={this.props.language === EventCodeLanguage.C}
        >
          <span className="newBoardVersion" title="C programming language">
            C
          </span>
        </ToggleButton>
        <ToggleButton
          id={EventCodeLanguage.MIPS}
          allowDeselect={false}
          onToggled={this.onLanguageChange}
          pressed={this.props.language === EventCodeLanguage.MIPS}
        >
          <span className="newBoardVersion" title="MIPS assembly language">
            MIPS
          </span>
        </ToggleButton>
      </div>
    );
  }
}
