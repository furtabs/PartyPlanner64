import { Game } from "../types";
import type { ISymbol } from "./symbols";
import {
  inferGameFromSymbolPath,
  parseSymFile,
  toFetchableSymbolUrl,
} from "./parse";

const INLINE_STORAGE_PREFIX = "pp64.extraSymbol.";
const inlineMemory = new Map<string, string>();

export type ExtraSymbolListKind = "decomp" | "extra";

export interface IExtraSymbolSource {
  id: string;
  /** HTTP(S) URL or local filename. */
  path: string;
  /** When set, used instead of inferring from the filename. */
  game?: Game;
  /** True when the CSV was imported from a local file and stored in localStorage. */
  inline?: boolean;
  kind?: ExtraSymbolListKind;
}

/** NTSC-U splat files from https://github.com/mariopartyrd */
export const DEFAULT_DECOMP_SYMBOL_SOURCES: IExtraSymbolSource[] = [
  {
    id: "decomp-mp1-usa",
    path: "https://github.com/mariopartyrd/marioparty/blob/master/symbol_addrs.txt",
    game: Game.MP1_USA,
    kind: "decomp",
  },
  {
    id: "decomp-mp2-usa",
    path: "https://github.com/mariopartyrd/marioparty2/blob/master/symbol_addrs.txt",
    game: Game.MP2_USA,
    kind: "decomp",
  },
  {
    id: "decomp-mp3-usa",
    path: "https://github.com/mariopartyrd/marioparty3/blob/main/symbol_addrs.txt",
    game: Game.MP3_USA,
    kind: "decomp",
  },
];

export type ExtraSymbolLoadState = "idle" | "loading" | "ok" | "error";

export interface IExtraSymbolStatus {
  id: string;
  path: string;
  game?: Game;
  kind?: ExtraSymbolListKind;
  state: ExtraSymbolLoadState;
  count?: number;
  error?: string;
}

let extraByGame: Map<Game, ISymbol[]> = new Map();
let statuses: IExtraSymbolStatus[] = [];
let loadGeneration = 0;

const listeners = new Set<() => void>();

export function createExtraSymbolSourceId(): string {
  return `sym-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function parseExtraSymbolSources(value: unknown): IExtraSymbolSource[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: IExtraSymbolSource[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const rec = entry as Partial<IExtraSymbolSource>;
    if (typeof rec.id !== "string" || typeof rec.path !== "string") {
      continue;
    }
    const source: IExtraSymbolSource = {
      id: rec.id,
      path: rec.path,
    };
    if (rec.kind === "decomp" || rec.kind === "extra") {
      source.kind = rec.kind;
    }
    if (rec.game && isGame(rec.game)) {
      source.game = rec.game;
    }
    if (rec.inline) {
      source.inline = true;
    }
    result.push(source);
  }
  return result;
}

function isGame(value: string): value is Game {
  return (Object.values(Game) as string[]).includes(value);
}

export function getExtraSymbols(game: Game): ISymbol[] {
  return extraByGame.get(game) ?? [];
}

export function getExtraSymbolStatuses(): IExtraSymbolStatus[] {
  return statuses;
}

export function addExtraSymbolListener(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function notify(): void {
  listeners.forEach((callback) => {
    callback();
  });
}

export function readInlineSymbolFile(id: string): string | null {
  if (inlineMemory.has(id)) {
    return inlineMemory.get(id)!;
  }
  if (typeof localStorage === "undefined") {
    return null;
  }
  try {
    return localStorage.getItem(INLINE_STORAGE_PREFIX + id);
  } catch {
    return null;
  }
}

export function writeInlineSymbolFile(id: string, contents: string): void {
  inlineMemory.set(id, contents);
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(INLINE_STORAGE_PREFIX + id, contents);
  } catch {
    // Ignore quota / privacy errors; in-memory copy still works this session.
  }
}

export function removeInlineSymbolFile(id: string): void {
  inlineMemory.delete(id);
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.removeItem(INLINE_STORAGE_PREFIX + id);
  } catch {
    // Ignore quota / privacy errors.
  }
}

async function readSourceText(source: IExtraSymbolSource): Promise<string> {
  if (source.inline) {
    const text = readInlineSymbolFile(source.id);
    if (text == null) {
      throw new Error("Saved symbol file is missing from browser storage.");
    }
    return text;
  }
  const url = toFetchableSymbolUrl(source.path);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch (${response.status})`);
  }
  return response.text();
}

/**
 * Fetches/parses extra .sym files and replaces the extra symbol tables.
 * Built-in PartyPlanner64 names are unchanged.
 */
export async function loadExtraSymbolSources(
  sources: IExtraSymbolSource[],
): Promise<void> {
  const gen = ++loadGeneration;
  statuses = sources.map((source) => ({
    id: source.id,
    path: source.path,
    game: source.game ?? inferGameFromSymbolPath(source.path),
    kind: source.kind,
    state: "loading",
  }));
  extraByGame = new Map();
  notify();

  const loaded: { game: Game; symbols: ISymbol[] }[] = [];

  await Promise.all(
    sources.map(async (source, index) => {
      try {
        const text = await readSourceText(source);
        if (gen !== loadGeneration) {
          return;
        }
        const symbols = parseSymFile(text);
        const game =
          source.game || inferGameFromSymbolPath(source.path);
        if (!game) {
          throw new Error(
            "Could not tell which game this file is for. Use a marioparty3 URL or MarioParty3U.sym filename.",
          );
        }
        loaded.push({ game, symbols });
        statuses[index] = {
          id: source.id,
          path: source.path,
          game,
          kind: source.kind,
          state: "ok",
          count: symbols.length,
        };
      } catch (err) {
        if (gen !== loadGeneration) {
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        statuses[index] = {
          id: source.id,
          path: source.path,
          game: source.game ?? inferGameFromSymbolPath(source.path),
          kind: source.kind,
          state: "error",
          error: message,
        };
      }
    }),
  );

  if (gen !== loadGeneration) {
    return;
  }

  const next = new Map<Game, ISymbol[]>();
  for (const { game, symbols } of loaded) {
    const prev = next.get(game) ?? [];
    next.set(game, prev.concat(symbols));
  }
  extraByGame = next;
  notify();
}
