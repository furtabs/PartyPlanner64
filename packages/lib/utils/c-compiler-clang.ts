/// <reference path="../lib/SmallerC/emscripten.d.ts" />

import { runEmscriptenMainAllowExit } from "./c-compiler-emscripten";
import {
  convertToNamedRegisters,
  fuseSections,
  includeFloatHelpers,
} from "./c-compiler-asm";
import { sanitizeClangAssembly } from "./c-compiler-clang-asm";
import { getClangOptLevel } from "./c-compiler-kind";

interface ClangFactory {
  (opts?: Partial<EmscriptenModule>): Promise<EmscriptenModule>;
}

interface ClangModule extends EmscriptenModule {
  callMain?: (args: string[]) => number;
}

interface ClangAssets {
  factory: ClangFactory;
  wasmBinary: Uint8Array | undefined;
  jsUrl: string;
}

let clangAssetsPromise: Promise<ClangAssets> | null = null;
let clangOutputSink: (text: string) => void = () => {};

export interface ClangCompileProgress {
  label: string;
  percent: number;
}

type ClangProgressListener = (progress: ClangCompileProgress | null) => void;
const clangProgressListeners = new Set<ClangProgressListener>();

export function addClangCompileProgressListener(
  listener: ClangProgressListener,
): () => void {
  clangProgressListeners.add(listener);
  return () => {
    clangProgressListeners.delete(listener);
  };
}

function setClangCompileProgress(
  progress: ClangCompileProgress | null,
): void {
  clangProgressListeners.forEach((listener) => {
    listener(progress);
  });
}

/**
 * N64Recomp-style Clang flags for VR4300 / o32, stopping at assembly
 * so mips-assembler can consume the result.
 *
 * The Emscripten Clang build has the MIPS backend but does not register
 * that backend's `cl::opt` flags. The driver forwards `-G0`,
 * `-mno-check-zero-division`, and (with `-mno-abicalls`) `-mgpopt` as
 * `-mllvm` options, which then fail option parsing. `-mno-gpopt` stops
 * that automatic `-mgpopt` pass; omit the other two for the same reason.
 */
export const CLANG_MIPS_ARGS = [
  "--target=mips-unknown-elf",
  "-march=mips2",
  "-mabi=32",
  "-mno-abicalls",
  "-mno-gpopt",
  "-mno-odd-spreg",
  "-fno-pic",
  "-fno-stack-protector",
  "-fomit-frame-pointer",
  "-ffreestanding",
  "-fno-builtin",
  "-fno-exceptions",
  "-fno-asynchronous-unwind-tables",
  "-fno-unwind-tables",
  "-fno-verbose-asm",
  "-mhard-float",
  "-nostdlib",
  "-nostdinc",
  // Event C calls game symbols without prototypes, as SmallerC allowed.
  "-Wno-implicit-function-declaration",
  "-Wno-implicit-int",
  "-S",
];

export function getClangMipsArgs(optLevel = getClangOptLevel()): string[] {
  return [...CLANG_MIPS_ARGS, `-${optLevel}`];
}

/** Vite `public/clang` and the Netlify copy under `public/assets/clang`. */
export const CLANG_PUBLIC_DIRS = ["clang", "assets/clang"] as const;

function getViteBaseUrl(): string {
  try {
    const env = (import.meta as ImportMeta & { env?: { BASE_URL?: string } })
      .env;
    return env?.BASE_URL || "./";
  } catch {
    return "./";
  }
}

function joinUrl(base: string, path: string): string {
  if (/^https?:\/\//.test(path) || path.startsWith("file:")) {
    return path;
  }
  if (base.endsWith("/") && path.startsWith("/")) {
    return base + path.slice(1);
  }
  if (!base.endsWith("/") && !path.startsWith("/")) {
    return `${base}/${path}`;
  }
  return base + path;
}

function getPageUrl(): string | undefined {
  if (typeof document !== "undefined" && document.baseURI) {
    return document.baseURI;
  }
  if (typeof location !== "undefined" && location.href) {
    return location.href;
  }
  return undefined;
}

/**
 * Resolve a file from Vite's `public/` directory against the page URL.
 *
 * `import("./clang/clang.js")` is resolved against the bundled module
 * (`/assets/index-*.js`). XHR/fetch of `./clang/clang.wasm` is resolved
 * against the page (`/clang/clang.wasm`). Those must be the same absolute URL.
 */
export function resolvePublicAssetUrl(
  relativePath: string,
  viteBase = getViteBaseUrl(),
  pageUrl = getPageUrl(),
): string {
  const joined = joinUrl(viteBase, relativePath);
  if (/^https?:\/\//.test(joined) || joined.startsWith("file:")) {
    return joined;
  }
  if (pageUrl) {
    return new URL(joined, pageUrl).href;
  }
  return joined;
}

export function clangUrlsForDir(
  dir: string,
  viteBase = getViteBaseUrl(),
  pageUrl = getPageUrl(),
): { jsUrl: string; wasmUrl: string } {
  const jsUrl = resolvePublicAssetUrl(`${dir}/clang.js`, viteBase, pageUrl);
  return {
    jsUrl,
    wasmUrl: new URL("clang.wasm", jsUrl).href,
  };
}

async function publicAssetExists(url: string): Promise<boolean> {
  if (typeof fetch !== "function") {
    return true;
  }
  try {
    const response = await fetch(url, { method: "HEAD" });
    if (!response.ok) {
      return false;
    }
    const type = response.headers.get("content-type") || "";
    return !type.includes("text/html");
  } catch {
    return false;
  }
}

function nodeProcess():
  | {
      env?: { PP64_CLANG_DIR?: string };
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
        env?: { PP64_CLANG_DIR?: string };
        versions?: { node?: string };
        cwd: () => string;
      };
    }
  ).process;
}

async function getClangAssetUrls(): Promise<{
  jsUrl: string;
  wasmUrl: string;
}> {
  const proc = nodeProcess();
  if (proc?.versions?.node) {
    const path = await import(/* @vite-ignore */ "path");
    const fs = await import(/* @vite-ignore */ "fs");
    const { pathToFileURL } = await import(/* @vite-ignore */ "url");

    const candidates = [
      proc.env?.PP64_CLANG_DIR,
      path.join(proc.cwd(), "public", "clang"),
      path.join(proc.cwd(), "public", "assets", "clang"),
      path.join(proc.cwd(), "clang"),
    ].filter((p): p is string => !!p);

    for (const dir of candidates) {
      const jsPath = path.join(dir, "clang.js");
      const wasmPath = path.join(dir, "clang.wasm");
      if (fs.existsSync(jsPath) && fs.existsSync(wasmPath)) {
        return {
          jsUrl: pathToFileURL(jsPath).href,
          wasmUrl: pathToFileURL(wasmPath).href,
        };
      }
    }
  }

  for (const dir of CLANG_PUBLIC_DIRS) {
    const urls = clangUrlsForDir(dir);
    if (await publicAssetExists(urls.jsUrl)) {
      return urls;
    }
  }

  return clangUrlsForDir(CLANG_PUBLIC_DIRS[0]);
}

async function loadClangWasmBinary(
  wasmUrl: string,
): Promise<Uint8Array | undefined> {
  if (nodeProcess()?.versions?.node && wasmUrl.startsWith("file:")) {
    const fs = await import(/* @vite-ignore */ "fs");
    const { fileURLToPath } = await import(/* @vite-ignore */ "url");
    return new Uint8Array(fs.readFileSync(fileURLToPath(wasmUrl)));
  }
  if (typeof fetch !== "function") {
    return undefined;
  }
  setClangCompileProgress({ label: "Downloading Clang…", percent: 8 });
  return fetchBinaryWithProgress(wasmUrl, (received, total) => {
    const ratio = total > 0 ? received / total : 0;
    setClangCompileProgress({
      label: "Downloading Clang…",
      percent: 8 + Math.round(ratio * 52),
    });
  });
}

function missingClangError(): Error {
  return new Error(
    "N64Recomp Clang WASM is not built. Run `python3 scripts/build-clang-wasm.py` (requires Emscripten, CMake, and Ninja). SmallerC is available only for legacy event scripts.",
  );
}

async function fetchBinaryWithProgress(
  url: string,
  onProgress: (received: number, total: number) => void,
): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url} (${response.status})`);
  }
  const total = Number(response.headers.get("content-length")) || 0;
  if (!response.body) {
    return new Uint8Array(await response.arrayBuffer());
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    received += value.byteLength;
    onProgress(received, total);
  }

  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function loadClangAssets(): Promise<ClangAssets> {
  if (clangAssetsPromise) {
    return clangAssetsPromise;
  }

  clangAssetsPromise = (async () => {
    const { jsUrl, wasmUrl } = await getClangAssetUrls();

    setClangCompileProgress({ label: "Loading Clang…", percent: 4 });

    let factory: ClangFactory;
    try {
      const mod = (await import(/* @vite-ignore */ jsUrl)) as {
        default: ClangFactory;
      };
      factory = mod.default;
    } catch (e) {
      const error = missingClangError();
      error.message += `\nTried to load ${jsUrl}`;
      error.cause = e;
      throw error;
    }

    if (typeof factory !== "function") {
      const error = missingClangError();
      error.message += `\nTried to load ${jsUrl}`;
      throw error;
    }

    const wasmBinary = await loadClangWasmBinary(wasmUrl);
    return { factory, wasmBinary, jsUrl };
  })().catch((e) => {
    clangAssetsPromise = null;
    throw e;
  });

  return clangAssetsPromise;
}

async function createClangModule(): Promise<ClangModule> {
  const { factory, wasmBinary, jsUrl } = await loadClangAssets();

  setClangCompileProgress({ label: "Starting Clang…", percent: 65 });

  return factory({
    noInitialRun: true,
    noExitRuntime: true,
    locateFile: (path: string, scriptDirectory: string) => {
      if (path.endsWith(".wasm")) {
        return new URL("clang.wasm", jsUrl).href;
      }
      return scriptDirectory + path;
    },
    wasmBinary,
    print: (text: string) => clangOutputSink(text),
    printErr: (text: string) => clangOutputSink(text),
  }) as Promise<ClangModule>;
}

export function resetClangModule(): void {
  clangAssetsPromise = null;
}

export async function compileWithClang(source: string): Promise<string> {
  const errors: string[] = [];
  clangOutputSink = (text: string) => {
    errors.push(text.replace(/\/input\.c/g, "input.c"));
  };

  setClangCompileProgress({
    label: clangAssetsPromise ? "Starting Clang…" : "Loading Clang…",
    percent: clangAssetsPromise ? 60 : 2,
  });

  try {
    const clang = await createClangModule();

    try {
      clang.FS.unlink("/input.c");
    } catch {
      // File may not exist yet.
    }
    try {
      clang.FS.unlink("/output.s");
    } catch {
      // File may not exist yet.
    }

    setClangCompileProgress({ label: "Compiling with Clang…", percent: 82 });
    clang.FS.writeFile("/input.c", source, { flags: "w+" });

    const argv = [...getClangMipsArgs(), "-o", "/output.s", "/input.c"];
    const status = runEmscriptenMainAllowExit(clang, argv);
    if (status !== 0) {
      const details = errors.join("\n").trim();
      throw new Error(
        "Error during Clang event compile" +
          (details ? ":\n" + details : ` (exit code ${status})`),
      );
    }

    let result: string;
    try {
      result = clang.FS.readFile("/output.s", { encoding: "utf8" }) as string;
    } catch {
      const details = errors.join("\n").trim();
      throw new Error(
        "Clang did not produce assembly output" +
          (details ? ":\n" + details : "."),
      );
    }

    setClangCompileProgress({ label: "Preparing assembly…", percent: 94 });
    result = sanitizeClangAssembly(result);
    result = fuseSections(result);
    result = convertToNamedRegisters(result);
    result = includeFloatHelpers(result);
    return result;
  } finally {
    setClangCompileProgress(null);
  }
}
