/// <reference path="../lib/SmallerC/emscripten.d.ts" />

export function str2ptr(env: EmscriptenModule, s: string): number {
  const ptr = env._malloc((s.length + 1) * Uint8Array.BYTES_PER_ELEMENT);
  if (!ptr) {
    throw new Error("Null pointer returned in str2ptr");
  }

  for (let i = 0; i < s.length; i++) {
    env.setValue(ptr + i, s.charCodeAt(i), "i8");
  }
  env.setValue(ptr + s.length, 0, "i8");
  return ptr;
}

export function str2ptrs(env: EmscriptenModule, strList: string[]): number {
  const listPtr = env._malloc(strList.length * Uint32Array.BYTES_PER_ELEMENT);
  if (!listPtr) {
    throw new Error("Null pointer returned in str2ptrs");
  }

  strList.forEach((s, idx) => {
    const strPtr = str2ptr(env, s);
    env.setValue(listPtr + 4 * idx, strPtr, "i32");
  });

  return listPtr;
}

interface EmscriptenMainModule extends EmscriptenModule {
  callMain?: (args: string[]) => number;
}

function isExitStatus(e: unknown): e is { status: number; name: string } {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { name?: string }).name === "ExitStatus" &&
    typeof (e as { status?: unknown }).status === "number"
  );
}

/**
 * Runs an Emscripten program's main(), treating a 0 exit as success.
 * Clang/Emscripten typically throws ExitStatus when main returns.
 */
export function runEmscriptenMain(
  env: EmscriptenMainModule,
  argv: string[],
): number {
  if (typeof env.callMain === "function") {
    return env.callMain(argv);
  }
  const args = [argv.length, str2ptrs(env, argv)];
  return env.ccall("main", "number", ["number", "number"], args);
}

export function runEmscriptenMainAllowExit(
  env: EmscriptenMainModule,
  argv: string[],
): number {
  try {
    const status = runEmscriptenMain(env, argv);
    return typeof status === "number" ? status : 0;
  } catch (e) {
    if (isExitStatus(e)) {
      return e.status;
    }
    throw e;
  }
}
