/// <reference path="../lib/SmallerC/emscripten.d.ts" />

import SmallerC from "../lib/SmallerC/smlrc";
import { str2ptrs } from "./c-compiler-emscripten";
import {
  convertToNamedRegisters,
  fuseSections,
  includeFloatHelpers,
} from "./c-compiler-asm";

// Web: This will be a URL pointing to the C compiler wasm file.
// CLI: This will be a Uint8Array instance.
import smlrcWasm from "../lib/SmallerC/smlrc.wasm?url";

export async function compileWithSmallerC(source: string): Promise<string> {
  let _smallerCInstance: EmscriptenModule;

  const errors: string[] = [];
  const addError = (text: string) => {
    text = text.replace('in "/input.c"', ""); // Input file not useful in error messages.
    errors.push(text);
  };

  const _smallerCPromiseLike: PromiseLike<EmscriptenModule> = SmallerC({
    noInitialRun: true,
    locateFile: (path: string, scriptDirectory: string) => {
      if (path === "smlrc.wasm") {
        // This will hit for both Web and CLI, but only web's return value matters.
        if (typeof smlrcWasm === "string") {
          return smlrcWasm;
        }
      }
      return scriptDirectory + path; // Same as default in smlrc.js's locateFile
    },
    wasmBinary:
      typeof smlrcWasm === "object" ? (smlrcWasm as Uint8Array) : undefined,
    print: addError,
    printErr: addError,
  });

  const smallerCPromise = new Promise<void>((resolve) => {
    _smallerCPromiseLike.then((Module) => {
      _smallerCInstance = Module;
      resolve();
    });
  });
  await smallerCPromise;

  _smallerCInstance!.FS.writeFile("/input.c", source, { flags: "w+" });

  const outputFile = "/output.s";
  const argv = ["./smallerc", "/input.c", outputFile];
  const args = [argv.length, str2ptrs(_smallerCInstance!, argv)];

  try {
    _smallerCInstance!.ccall("main", "number", ["number", "number"], args);
  } catch (e) {
    throw new Error("Error during event compile:\n" + errors.join("\n"));
  }

  let result = _smallerCInstance!.FS.readFile(outputFile, {
    encoding: "utf8",
  }) as string;
  result = fuseSections(result);
  result = convertToNamedRegisters(result);
  result = includeFloatHelpers(result);
  return result;
}
