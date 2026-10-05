import * as React from "react";
import {
  addClangCompileProgressListener,
  ClangCompileProgress,
} from "../../../packages/lib/utils/c-compiler-clang";

import "../css/clangcompileprogress.scss";

/** Fixed progress bar shown while the Clang WASM compiler is loading or running. */
export function ClangCompileProgressBar() {
  const [progress, setProgress] =
    React.useState<ClangCompileProgress | null>(null);

  React.useEffect(() => addClangCompileProgressListener(setProgress), []);

  if (!progress) {
    return null;
  }

  return (
    <div
      className="clangCompileProgress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress.percent}
      aria-label={progress.label}
    >
      <div className="clangCompileProgressLabel">{progress.label}</div>
      <div className="clangCompileProgressTrack">
        <div
          className="clangCompileProgressFill"
          style={{ width: `${Math.max(2, Math.min(100, progress.percent))}%` }}
        />
      </div>
    </div>
  );
}
