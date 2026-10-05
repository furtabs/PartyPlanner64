import * as cpp from "../lib/cppjs/cppjs";
import { ultra64h } from "../events/includes/ultra64h";
import {
  IEventProjectFiles,
  resolveProjectInclude,
} from "../events/eventproject";

export type PreprocessIncludes = IEventProjectFiles | Record<string, string>;

function resolveInclude(
  file: string,
  includes?: PreprocessIncludes,
): string | null {
  if (file.toLowerCase() === "ultra64.h") {
    return ultra64h;
  }

  if (!includes) {
    return null;
  }

  if ("src" in includes && "include" in includes) {
    return resolveProjectInclude(file, includes as IEventProjectFiles);
  }

  const map = includes as Record<string, string>;
  const normalized = file.replace(/\\/g, "/").replace(/^\.?\//, "");
  const basename = normalized.split("/").pop() || normalized;
  if (map[normalized] != null) return map[normalized];
  if (map[basename] != null) return map[basename];
  return null;
}

/** Preprocess a given file. */
export async function preprocess(
  contents: string,
  includes?: PreprocessIncludes,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const preprocessor = cpp.create({
      include_func: (file, is_global, resumer) => {
        const resolved = resolveInclude(file, includes);
        resumer(resolved);
      },

      completion_func(preprocessedText) {
        resolve(preprocessedText);
      },

      warn_func(message: string) {
        console.warn(message);
      },

      error_func(message: string) {
        console.error(message);
        reject(message);
      },
    });

    preprocessor.run(contents);
  });
}
