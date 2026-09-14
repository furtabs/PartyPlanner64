/** Folder roots for a C event source project. */
export type EventProjectFolder = "src" | "include";

/** Virtual filesystem for a C event (src + include). */
export interface IEventProjectFiles {
  src: Record<string, string>;
  include: Record<string, string>;
}

export const DEFAULT_ENTRY_FILE = "main.c";

export function createDefaultCProject(code: string): IEventProjectFiles {
  return {
    src: { [DEFAULT_ENTRY_FILE]: code },
    include: {},
  };
}

/** Normalize legacy single-string events into a src/include project. */
export function normalizeEventProject(
  code: string,
  files?: IEventProjectFiles | null,
): IEventProjectFiles {
  if (files?.src && Object.keys(files.src).length > 0) {
    const src = { ...files.src };
    if (!(DEFAULT_ENTRY_FILE in src)) {
      src[DEFAULT_ENTRY_FILE] = code || Object.values(src)[0] || "";
    }
    return {
      src,
      include: { ...(files.include || {}) },
    };
  }
  return createDefaultCProject(code);
}

export function getEntrySource(files: IEventProjectFiles): string {
  if (files.src[DEFAULT_ENTRY_FILE] != null) {
    return files.src[DEFAULT_ENTRY_FILE];
  }
  const first = Object.keys(files.src)[0];
  return first ? files.src[first] : "";
}

export function cloneEventProject(files: IEventProjectFiles): IEventProjectFiles {
  return {
    src: { ...files.src },
    include: { ...files.include },
  };
}

export function projectFilesEqual(
  a: IEventProjectFiles,
  b: IEventProjectFiles,
): boolean {
  return (
    JSON.stringify(sortedProject(a)) === JSON.stringify(sortedProject(b))
  );
}

function sortedProject(files: IEventProjectFiles): IEventProjectFiles {
  return {
    src: sortRecord(files.src),
    include: sortRecord(files.include),
  };
}

function sortRecord(record: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(record).sort()) {
    out[key] = record[key];
  }
  return out;
}

export function listProjectFiles(
  files: IEventProjectFiles,
  folder: EventProjectFolder,
): string[] {
  return Object.keys(files[folder]).sort((a, b) => {
    if (a === DEFAULT_ENTRY_FILE) return -1;
    if (b === DEFAULT_ENTRY_FILE) return 1;
    return a.localeCompare(b);
  });
}

export function isValidProjectFileName(name: string): boolean {
  return /^[A-Za-z_][\w.-]*\.(c|h)$/.test(name);
}

export function suggestProjectFileName(
  folder: EventProjectFolder,
  existing: Record<string, string>,
): string {
  const ext = folder === "include" ? "h" : "c";
  const base = folder === "include" ? "header" : "file";
  let candidate = `${base}.${ext}`;
  let i = 2;
  while (existing[candidate] != null) {
    candidate = `${base}${i}.${ext}`;
    i++;
  }
  return candidate;
}

/**
 * Resolve an #include path against the event project.
 * Checks include/ then src/, by full relative path and basename.
 */
export function resolveProjectInclude(
  file: string,
  files: IEventProjectFiles,
): string | null {
  const normalized = file.replace(/\\/g, "/").replace(/^\.?\//, "");
  const basename = normalized.split("/").pop() || normalized;

  const candidates = [
    normalized,
    basename,
    normalized.replace(/^include\//, ""),
    normalized.replace(/^src\//, ""),
  ];

  for (const key of candidates) {
    if (files.include[key] != null) return files.include[key];
  }
  for (const key of candidates) {
    if (files.src[key] != null) return files.src[key];
  }
  return null;
}

/** Flat include map used by older call sites / tests. */
export function projectToIncludeMap(
  files?: IEventProjectFiles | null,
): Record<string, string> {
  if (!files) return {};
  return {
    ...files.src,
    ...files.include,
  };
}
