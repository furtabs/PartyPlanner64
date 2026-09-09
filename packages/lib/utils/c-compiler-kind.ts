/** In-browser / CLI C compilers available for event code. */
export enum CCompilerKind {
  /** Original SmallerC frontend, kept for compatibility with existing events. */
  SmallerC = "smallerc",
  /** N64Recomp Clang (MIPS), built with Emscripten. */
  Clang = "clang",
}

export type ClangOptLevel = "O0" | "O1" | "O2";

export const CLANG_OPT_LEVELS: ClangOptLevel[] = ["O0", "O1", "O2"];

function nodeProcess():
  | {
      env?: {
        PP64_C_COMPILER?: string;
        PP64_CLANG_OPT?: string;
        PP64_CLANG_DIR?: string;
      };
      versions?: { node?: string };
      cwd: () => string;
    }
  | undefined {
  if (typeof globalThis === "undefined") {
    return undefined;
  }
  return (
    globalThis as {
      process?: {
        env?: {
          PP64_C_COMPILER?: string;
          PP64_CLANG_OPT?: string;
          PP64_CLANG_DIR?: string;
        };
        versions?: { node?: string };
        cwd: () => string;
      };
    }
  ).process;
}

export function parseCCompilerKind(value: unknown): CCompilerKind {
  if (value === CCompilerKind.SmallerC || value === "smallerc") {
    return CCompilerKind.SmallerC;
  }
  return CCompilerKind.Clang;
}

let currentKind: CCompilerKind = parseCCompilerKind(
  nodeProcess()?.env?.PP64_C_COMPILER,
);

export function getCCompilerKind(): CCompilerKind {
  return currentKind;
}

export function setCCompilerKind(kind: CCompilerKind | undefined): void {
  currentKind = parseCCompilerKind(kind);
}

export function parseClangOptLevel(value: unknown): ClangOptLevel {
  if (value === "O0" || value === "0" || value === 0) {
    return "O0";
  }
  if (value === "O1" || value === "1" || value === 1) {
    return "O1";
  }
  return "O2";
}

let currentOptLevel: ClangOptLevel = parseClangOptLevel(
  nodeProcess()?.env?.PP64_CLANG_OPT,
);

export function getClangOptLevel(): ClangOptLevel {
  return currentOptLevel;
}

export function setClangOptLevel(level: ClangOptLevel | undefined): void {
  currentOptLevel = parseClangOptLevel(level);
}
