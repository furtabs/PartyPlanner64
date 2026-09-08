/// <reference path="../lib/SmallerC/emscripten.d.ts" />

import { runEmscriptenMainAllowExit } from "./c-compiler-emscripten";
import {
  convertToNamedRegisters,
  fuseSections,
  includeFloatHelpers,
} from "./c-compiler-asm";
import { sanitizeClangAssembly } from "./c-compiler-clang-asm";

interface ClangFactory {
  (opts?: Partial<EmscriptenModule>): Promise<EmscriptenModule>;
}

interface ClangModule extends EmscriptenModule {
  callMain?: (args: string[]) => number;
}

let clangModulePromise: Promise<ClangModule> | null = null;
let clangOutputSink: (text: string) => void = () => {};

/**
 * N64Recomp-style Clang flags for VR4300 / o32, stopping at assembly
 * so mips-assembler can consume the result.
 */
export const CLANG_MIPS_ARGS = [
  "--target=mips-unknown-elf",
  "-march=mips2",
  "-mabi=32",
  "-mno-abicalls",
  "-mno-odd-spreg",
  "-mno-check-zero-division",
  "-G0",
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
  "-O2",
  "-S",
];

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

  const base = getViteBaseUrl();
  return {
    jsUrl: joinUrl(base, "clang/clang.js"),
    wasmUrl: joinUrl(base, "clang/clang.wasm"),
  };
}

async function loadClangWasmBinary(
  wasmUrl: string,
): Promise<Uint8Array | undefined> {
  if (nodeProcess()?.versions?.node && wasmUrl.startsWith("file:")) {
    const fs = await import(/* @vite-ignore */ "fs");
    const { fileURLToPath } = await import(/* @vite-ignore */ "url");
    return new Uint8Array(fs.readFileSync(fileURLToPath(wasmUrl)));
  }
  return undefined;
}

function missingClangError(): Error {
  return new Error(
    "N64Recomp Clang WASM is not built. Run `python3 scripts/build-clang-wasm.py` (requires Emscripten, CMake, and Ninja), or switch the C compiler back to SmallerC.",
  );
}

async function instantiateClang(): Promise<ClangModule> {
  const { jsUrl, wasmUrl } = await getClangAssetUrls();

  let factory: ClangFactory;
  try {
    const mod = (await import(/* @vite-ignore */ jsUrl)) as {
      default: ClangFactory;
    };
    factory = mod.default;
  } catch {
    throw missingClangError();
  }

  if (typeof factory !== "function") {
    throw missingClangError();
  }

  const wasmBinary = await loadClangWasmBinary(wasmUrl);

  return factory({
    noInitialRun: true,
    noExitRuntime: true,
    locateFile: (path: string, scriptDirectory: string) => {
      if (path.endsWith(".wasm")) {
        return wasmUrl;
      }
      return scriptDirectory + path;
    },
    wasmBinary,
    print: (text: string) => clangOutputSink(text),
    printErr: (text: string) => clangOutputSink(text),
  }) as Promise<ClangModule>;
}

async function getClangModule(): Promise<ClangModule> {
  if (!clangModulePromise) {
    clangModulePromise = instantiateClang().catch((e) => {
      clangModulePromise = null;
      throw e;
    });
  }
  return clangModulePromise;
}

export function resetClangModule(): void {
  clangModulePromise = null;
}

export async function compileWithClang(source: string): Promise<string> {
  const errors: string[] = [];
  clangOutputSink = (text: string) => {
    errors.push(text.replace(/\/input\.c/g, "input.c"));
  };

  const clang = await getClangModule();

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

  clang.FS.writeFile("/input.c", source, { flags: "w+" });

  const argv = [...CLANG_MIPS_ARGS, "-o", "/output.s", "/input.c"];
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

  result = sanitizeClangAssembly(result);
  result = fuseSections(result);
  result = convertToNamedRegisters(result);
  result = includeFloatHelpers(result);
  return result;
}
