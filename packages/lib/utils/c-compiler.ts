import { preprocess, PreprocessIncludes } from "./c-preprocessor";
import { CCompilerKind, getCCompilerKind } from "./c-compiler-kind";
import { compileWithSmallerC } from "./c-compiler-smallerc";
import { compileWithClang } from "./c-compiler-clang";

export {
  CCompilerKind,
  getCCompilerKind,
  setCCompilerKind,
  getClangOptLevel,
  setClangOptLevel,
  parseClangOptLevel,
  CLANG_OPT_LEVELS,
} from "./c-compiler-kind";
export type { ClangOptLevel } from "./c-compiler-kind";

/**
 * Compiles C source to MIPS assembly.
 * @param source C source code string (typically src/main.c)
 * @param kind Compiler backend
 * @param includes Event project files or flat include map for #include resolution
 */
export async function compile(
  source: string,
  kind: CCompilerKind = getCCompilerKind(),
  includes?: PreprocessIncludes,
): Promise<string> {
  try {
    source = await preprocess(source, includes);
    //$$log("preprocessed:", source);
  } catch (e) {
    if (typeof e === "string") {
      throw new Error(e);
    }
    throw e;
  }

  switch (kind) {
    case CCompilerKind.Clang:
      return compileWithClang(source);
    case CCompilerKind.SmallerC:
    default:
      return compileWithSmallerC(source);
  }
}
