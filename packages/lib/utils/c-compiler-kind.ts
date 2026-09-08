/** In-browser / CLI C compilers available for event code. */
export enum CCompilerKind {
  /** Original SmallerC frontend, kept for compatibility with existing events. */
  SmallerC = "smallerc",
  /** N64Recomp Clang (MIPS), built with Emscripten. */
  Clang = "clang",
}

function nodeProcess():
  | {
      env?: { PP64_C_COMPILER?: string; PP64_CLANG_DIR?: string };
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
        env?: { PP64_C_COMPILER?: string; PP64_CLANG_DIR?: string };
        versions?: { node?: string };
        cwd: () => string;
      };
    }
  ).process;
}

export function parseCCompilerKind(value: unknown): CCompilerKind {
  if (value === CCompilerKind.Clang || value === "clang") {
    return CCompilerKind.Clang;
  }
  return CCompilerKind.SmallerC;
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
