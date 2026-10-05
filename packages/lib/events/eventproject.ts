/** Folder roots for a C event source project. */
export type EventProjectFolder = "src" | "include";

/** Virtual filesystem for a C event (src + include). */
export interface IEventProjectFiles {
  src: Record<string, string>;
  include: Record<string, string>;
}

export const DEFAULT_ENTRY_FILE = "main.c";

/** Comment marker used to embed multiple project files in a single .c export. */
export const PP64_FILE_MARKER = "// @@PP64_FILE";

const FILE_BREAK_RE =
  /^\/\/ @@PP64_FILE\s+(src|include)\/([A-Za-z_][\w.-]*\.(?:c|h))\s*$/;

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

  const unpacked = unpackEventProject(code);
  if (unpacked) {
    return unpacked;
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

/** True when the project has more than a lone src/main.c. */
export function eventProjectHasExtraFiles(files: IEventProjectFiles): boolean {
  const srcNames = Object.keys(files.src);
  const includeNames = Object.keys(files.include);
  if (includeNames.length > 0) return true;
  if (srcNames.length !== 1) return true;
  return srcNames[0] !== DEFAULT_ENTRY_FILE;
}

/**
 * Serialize a project into a single .c blob with file-break markers.
 * Example:
 *   // @@PP64_FILE src/main.c
 *   ...
 *   // @@PP64_FILE include/types.h
 *   ...
 */
export function packEventProject(files: IEventProjectFiles): string {
  const project = normalizeEventProject(getEntrySource(files), files);
  const sections: string[] = [];

  for (const name of listProjectFiles(project, "src")) {
    sections.push(formatPackedSection("src", name, project.src[name]));
  }
  for (const name of listProjectFiles(project, "include")) {
    sections.push(formatPackedSection("include", name, project.include[name]));
  }

  return sections.join("\n\n") + "\n";
}

function formatPackedSection(
  folder: EventProjectFolder,
  name: string,
  content: string,
): string {
  const body = content.replace(/^\uFEFF/, "").replace(/\s+$/, "");
  return `${PP64_FILE_MARKER} ${folder}/${name}\n${body}`;
}

/**
 * Parse a packed multi-file .c export back into a project.
 * Returns null when the text is a plain single-file event.
 */
export function unpackEventProject(code: string): IEventProjectFiles | null {
  if (!code || !code.includes(PP64_FILE_MARKER)) {
    return null;
  }

  const lines = code.replace(/^\uFEFF/, "").split(/\r?\n/);
  const src: Record<string, string> = {};
  const include: Record<string, string> = {};

  let folder: EventProjectFolder | null = null;
  let name: string | null = null;
  let body: string[] = [];

  const flush = () => {
    if (!folder || !name) return;
    const text = body.join("\n").replace(/^\n+/, "").replace(/\s+$/, "");
    if (folder === "src") {
      src[name] = text;
    } else {
      include[name] = text;
    }
  };

  for (const line of lines) {
    const match = FILE_BREAK_RE.exec(line);
    if (match) {
      flush();
      folder = match[1] as EventProjectFolder;
      name = match[2];
      body = [];
      continue;
    }
    if (folder && name) {
      body.push(line);
    }
  }
  flush();

  if (!Object.keys(src).length && !Object.keys(include).length) {
    return null;
  }

  if (!(DEFAULT_ENTRY_FILE in src)) {
    // Require an entry file; treat invalid packs as plain source.
    if (!Object.keys(src).length) {
      return null;
    }
    const first = Object.keys(src).sort()[0];
    src[DEFAULT_ENTRY_FILE] = src[first];
  }

  return { src, include };
}

/**
 * Text content to download for a C event (.c), packing multi-file projects.
 */
export function getCEventExportText(
  code: string,
  files?: IEventProjectFiles | null,
): string {
  const project = normalizeEventProject(code, files);
  if (!eventProjectHasExtraFiles(project)) {
    return getEntrySource(project);
  }
  return packEventProject(project);
}
