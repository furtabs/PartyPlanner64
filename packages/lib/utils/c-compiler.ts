import { preprocess } from "./c-preprocessor";
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
 * @param source C source code string
 */
export async function compile(
  source: string,
  kind: CCompilerKind = getCCompilerKind(),
): Promise<string> {
  try {
    source = await preprocess(source);
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
