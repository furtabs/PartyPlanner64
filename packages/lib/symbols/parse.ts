import { Game } from "../types";
import type { ISymbol } from "./symbols";

const FILE_GAME_PATTERNS: [RegExp, Game][] = [
  [/MarioParty1U/i, Game.MP1_USA],
  [/MarioParty1J/i, Game.MP1_JPN],
  [/MarioParty1E/i, Game.MP1_PAL],
  [/MarioParty2U/i, Game.MP2_USA],
  [/MarioParty2J/i, Game.MP2_JPN],
  [/MarioParty3U/i, Game.MP3_USA],
  [/MarioParty3J/i, Game.MP3_JPN],
];

/** mariopartyrd decomp repos: /marioparty3, /marioparty2, /marioparty (MP1). */
const DECOMP_REPO_PATTERNS: [RegExp, Game][] = [
  [/\/marioparty3(?:\/|$)/i, Game.MP3_USA],
  [/\/marioparty2(?:\/|$)/i, Game.MP2_USA],
  [/\/marioparty(?:\/|$)/i, Game.MP1_USA],
];

const SPLAT_LINE =
  /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(0x[0-9A-Fa-f]+)\s*;?\s*(?:\/\/\s*(.*))?$/;

const CODE_TYPES = new Set(["code", "func", "function", "fn"]);

/**
 * Parses a symbol file: PartyPlanner64 `.sym` CSV or splat `symbol_addrs.txt`.
 *
 * CSV: addr,type,name[,desc]
 * Splat: name = 0xADDRESS; //type:s16 size:0x4
 */
export function parseSymFile(text: string): ISymbol[] {
  const symbols: ISymbol[] = [];
  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) {
      continue;
    }

    const splat = parseSplatSymbolLine(line);
    if (splat) {
      symbols.push(splat);
      continue;
    }

    const csv = parseCsvSymbolLine(line);
    if (csv) {
      symbols.push(csv);
    }
  }

  return symbols;
}

function parseSplatSymbolLine(line: string): ISymbol | undefined {
  const match = line.match(SPLAT_LINE);
  if (!match) {
    return undefined;
  }

  const name = match[1];
  if (name.endsWith("?") || name.startsWith("?")) {
    return undefined;
  }

  const addr = parseInt(match[2], 16);
  if (!Number.isFinite(addr)) {
    return undefined;
  }

  const desc = (match[3] || "").trim();
  const typeFromComment = desc.match(/\btype:([A-Za-z0-9_]+)/i);
  let type = "code";
  if (typeFromComment) {
    const splatType = typeFromComment[1];
    type = CODE_TYPES.has(splatType.toLowerCase()) ? "code" : splatType;
  } else if (name.startsWith("D_")) {
    type = "data";
  }

  const symbol: ISymbol = { addr, type, name };
  if (desc) {
    symbol.desc = desc;
  }
  return symbol;
}

function parseCsvSymbolLine(line: string): ISymbol | undefined {
  const pieces = line.split(",");
  if (pieces.length < 3) {
    return undefined;
  }

  const addrToken = pieces[0].trim().replace(/^0x/i, "");
  const addr = parseInt(addrToken, 16);
  if (!Number.isFinite(addr)) {
    return undefined;
  }

  const type = pieces[1].trim();
  const name = pieces[2].trim();
  if (!type || !name) {
    return undefined;
  }

  if (name.endsWith("?") || name.startsWith("?")) {
    return undefined;
  }

  const symbol: ISymbol = { addr, type, name };
  const desc = pieces.slice(3).join(",").trim();
  if (desc) {
    symbol.desc = desc;
  }
  return symbol;
}

/** Last path segment of a URL or filesystem path. */
export function symbolPathBasename(path: string): string {
  try {
    const url = new URL(path);
    const parts = url.pathname.split("/").filter(Boolean);
    return decodeURIComponent(parts[parts.length - 1] || "");
  } catch {
    const normalized = path.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    return parts[parts.length - 1] || path;
  }
}

/**
 * Infers which ROM a symbol file belongs to from MarioParty3U.sym names
 * or mariopartyrd decomp repo URLs.
 */
export function inferGameFromSymbolPath(path: string): Game | undefined {
  for (const [pattern, game] of DECOMP_REPO_PATTERNS) {
    if (pattern.test(path)) {
      return game;
    }
  }
  const base = symbolPathBasename(path);
  for (const [pattern, game] of FILE_GAME_PATTERNS) {
    if (pattern.test(base) || pattern.test(path)) {
      return game;
    }
  }
  return undefined;
}

/**
 * Turns a GitHub blob page into a raw file URL so fetch() can load the file.
 */
export function toFetchableSymbolUrl(path: string): string {
  const trimmed = path.trim();
  const blob =
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i;
  const blobMatch = trimmed.match(blob);
  if (blobMatch) {
    return `https://raw.githubusercontent.com/${blobMatch[1]}/${blobMatch[2]}/${blobMatch[3]}/${blobMatch[4]}`;
  }
  const raw =
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/raw\/([^/]+)\/(.+)$/i;
  const rawMatch = trimmed.match(raw);
  if (rawMatch) {
    return `https://raw.githubusercontent.com/${rawMatch[1]}/${rawMatch[2]}/${rawMatch[3]}/${rawMatch[4]}`;
  }
  return trimmed;
}
