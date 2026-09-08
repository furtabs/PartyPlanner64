#!/usr/bin/env python3
"""Build N64Recomp Clang (MIPS-only LLVM) with Emscripten for PartyPlanner64.

Uses the same LLVM commit and MIPS target configuration as
https://github.com/LT-Schmiddy/n64recomp-clang so event C can be compiled
in the browser. Requires emcc, cmake, ninja, and git.

Output:
  public/clang/clang.js
  public/clang/clang.wasm

This takes a long time (native tblgen + emscripten clang) and several GB of disk.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
from pathlib import Path

# Release 22.1.1, same pin as n64recomp-clang.
LLVM_URL = "https://github.com/llvm/llvm-project.git"
LLVM_COMMIT = "fef02d48c08db859ef83f84232ed78bd9d1c323a"
LLVM_TAG = "llvmorg-22.1.1"

ROOT = Path(__file__).resolve().parent.parent
BUILD_ROOT = ROOT / ".clang-wasm-build"
LLVM_SRC = BUILD_ROOT / "llvm-project"
LLVM_DIR = LLVM_SRC / "llvm"
HOST_BUILD = BUILD_ROOT / "build-host"
HOST_BIN = BUILD_ROOT / "host-bin"
WASM_BUILD = BUILD_ROOT / "build-wasm"
OUTPUT_DIR = ROOT / "public" / "clang"

HOST_TBLGEN_TARGETS = [
    "llvm-tblgen",
    "clang-tblgen",
    "llvm-min-tblgen",
]

REQUIRED_HOST_TOOLS = (
    "llvm-tblgen",
    "clang-tblgen",
    "llvm-min-tblgen",
)

EMSCRIPTEN_LINK_FLAGS = " ".join(
    [
        "-sMODULARIZE=1",
        "-sEXPORT_ES6=1",
        "-sEXPORT_NAME=Clang",
        "-sENVIRONMENT=web,worker,node",
        "-sINVOKE_RUN=0",
        "-sEXIT_RUNTIME=0",
        "-sALLOW_MEMORY_GROWTH=1",
        "-sALLOW_TABLE_GROWTH=1",
        "-sINITIAL_MEMORY=67108864",
        "-sMAXIMUM_MEMORY=536870912",
        "-sSTACK_SIZE=2097152",
        "-sEXPORTED_RUNTIME_METHODS=['FS','callMain','ccall','cwrap']",
        "-sEXPORTED_FUNCTIONS=['_main','_malloc','_free']",
        "-sFILESYSTEM=1",
        "-sNODERAWFS=0",
        "-Wno-unused-command-line-argument",
    ]
)

COMMON_LLVM_CACHE = {
    "CMAKE_BUILD_TYPE": "MinSizeRel",
    "LLVM_TARGETS_TO_BUILD": "Mips",
    "LLVM_DEFAULT_TARGET_TRIPLE": "mips-unknown-elf",
    "LLVM_ENABLE_PROJECTS": "clang",
    "LLVM_ENABLE_RUNTIMES": "",
    "LLVM_INCLUDE_TESTS": "OFF",
    "LLVM_INCLUDE_EXAMPLES": "OFF",
    "LLVM_INCLUDE_BENCHMARKS": "OFF",
    "LLVM_INCLUDE_DOCS": "OFF",
    "LLVM_ENABLE_ASSERTIONS": "OFF",
    "LLVM_ENABLE_BACKTRACES": "OFF",
    "LLVM_ENABLE_UNWIND_TABLES": "OFF",
    "LLVM_ENABLE_CRASH_OVERRIDES": "OFF",
    "LLVM_ENABLE_TERMINFO": "OFF",
    "LLVM_ENABLE_LIBXML2": "OFF",
    "LLVM_ENABLE_ZLIB": "OFF",
    "LLVM_ENABLE_ZSTD": "OFF",
    "LLVM_ENABLE_PIC": "OFF",
    "LLVM_ENABLE_THREADS": "OFF",
    "LLVM_ENABLE_EH": "OFF",
    "LLVM_ENABLE_RTTI": "OFF",
    "LLVM_BUILD_TOOLS": "OFF",
    "LLVM_BUILD_UTILS": "ON",
    "LLVM_BUILD_LLVM_DYLIB": "OFF",
    "CLANG_ENABLE_STATIC_ANALYZER": "OFF",
    "CLANG_ENABLE_ARCMT": "OFF",
    "CLANG_INCLUDE_TESTS": "OFF",
    "CLANG_PLUGIN_SUPPORT": "OFF",
    "CLANG_TOOL_LIBCLANG_BUILD": "OFF",
}


def cpu_count() -> int:
    return os.cpu_count() or 2


def run(
    cmd: list[str],
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
) -> None:
    print("+", " ".join(str(c) for c in cmd), flush=True)
    result = subprocess.run(cmd, cwd=cwd, env=env)
    if result.returncode != 0:
        raise SystemExit(
            f"Command failed ({result.returncode}): {' '.join(str(c) for c in cmd)}"
        )


def git_head(repo: Path) -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repo,
        stdout=subprocess.PIPE,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return ""
    return result.stdout.strip()


def cmake_build(build_dir: Path, targets: list[str], jobs: int) -> None:
    cmd = ["cmake", "--build", str(build_dir), "--parallel", str(jobs)]
    for target in targets:
        cmd.extend(["--target", target])
    run(cmd)


def require_tool(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise SystemExit(f"Required tool '{name}' was not found on PATH.")
    print(f"Found {name}: {path}")
    return path


def cache_args(cache: dict[str, str]) -> list[str]:
    return [f"-D{key}={value}" for key, value in cache.items()]


def compiler_launcher_cache() -> dict[str, str]:
    if shutil.which("ccache"):
        return {
            "CMAKE_C_COMPILER_LAUNCHER": "ccache",
            "CMAKE_CXX_COMPILER_LAUNCHER": "ccache",
        }
    return {}


def download_llvm() -> None:
    require_tool("git")
    BUILD_ROOT.mkdir(parents=True, exist_ok=True)
    if LLVM_SRC.exists() and git_head(LLVM_SRC).startswith(LLVM_COMMIT[:12]):
        print(f"LLVM already checked out at {LLVM_COMMIT}")
        return

    if LLVM_SRC.exists():
        shutil.rmtree(LLVM_SRC)

    run(
        [
            "git",
            "clone",
            "--depth",
            "1",
            "--branch",
            LLVM_TAG,
            LLVM_URL,
            str(LLVM_SRC),
        ]
    )
    head = git_head(LLVM_SRC)
    if LLVM_COMMIT not in (head,):
        print(f"Warning: checked out {head}, expected {LLVM_COMMIT}")


def host_tool_path(host_bin: Path, name: str) -> Path:
    for candidate in (host_bin / name, host_bin / f"{name}.exe"):
        if candidate.is_file():
            return candidate
    raise SystemExit(f"Missing host tool {name} in {host_bin}")


def host_bin_is_complete(host_bin: Path) -> bool:
    try:
        for name in REQUIRED_HOST_TOOLS:
            host_tool_path(host_bin, name)
        return True
    except SystemExit:
        return False


def alias_host_tools_for_emscripten(host_bin: Path) -> None:
    """Emscripten sets LLVM_HOST_EXECUTABLE_SUFFIX=.js, so native tools must also
    be visible under that suffix or LLVM tries to build NATIVE/bin/*.js."""
    for name in REQUIRED_HOST_TOOLS:
        src = host_tool_path(host_bin, name)
        js_alias = host_bin / f"{name}.js"
        if not js_alias.exists():
            shutil.copy2(src, js_alias)


def plant_nested_native_tools(host_bin: Path) -> None:
    native_bin = WASM_BUILD / "NATIVE" / "bin"
    native_bin.mkdir(parents=True, exist_ok=True)
    for src in host_bin.iterdir():
        if not src.is_file():
            continue
        shutil.copy2(src, native_bin / src.name)
        if not src.name.endswith(".js"):
            shutil.copy2(src, native_bin / f"{src.name}.js")
    print(f"Planted host tblgen tools in {native_bin}")


def harvest_host_tools(source_bin: Path) -> Path:
    if HOST_BIN.exists():
        shutil.rmtree(HOST_BIN)
    HOST_BIN.mkdir(parents=True, exist_ok=True)
    copied = 0
    for src in source_bin.iterdir():
        if src.is_file() and os.access(src, os.X_OK):
            shutil.copy2(src, HOST_BIN / src.name)
            copied += 1
    print(f"Copied {copied} host tools to {HOST_BIN}")
    alias_host_tools_for_emscripten(HOST_BIN)
    return HOST_BIN


def native_cross_toolchain_flags() -> dict[str, str]:
    cc = shutil.which("cc") or shutil.which("gcc") or shutil.which("clang")
    cxx = shutil.which("c++") or shutil.which("g++") or shutil.which("clang++")
    if not cc or not cxx:
        return {}
    return {
        "CROSS_TOOLCHAIN_FLAGS_NATIVE": (
            f"-DCMAKE_C_COMPILER={cc};"
            f"-DCMAKE_CXX_COMPILER={cxx};"
            "-DCMAKE_EXECUTABLE_SUFFIX="
        )
    }


def build_host_tblgen(jobs: int) -> Path:
    require_tool("cmake")
    require_tool("ninja")
    HOST_BUILD.mkdir(parents=True, exist_ok=True)
    run(
        [
            "cmake",
            "-S",
            str(LLVM_DIR),
            "-B",
            str(HOST_BUILD),
            "-G",
            "Ninja",
            *cache_args(
                {
                    **COMMON_LLVM_CACHE,
                    **compiler_launcher_cache(),
                    "CMAKE_BUILD_TYPE": "Release",
                    "LLVM_BUILD_TOOLS": "ON",
                }
            ),
        ]
    )
    cmake_build(HOST_BUILD, HOST_TBLGEN_TARGETS, jobs)
    host_bin = HOST_BUILD / "bin"
    for needed in REQUIRED_HOST_TOOLS:
        host_tool_path(host_bin, needed)
    return harvest_host_tools(host_bin)


def build_emscripten_clang(host_bin: Path, jobs: int) -> None:
    emcmake = require_tool("emcmake")
    require_tool("emcc")
    require_tool("cmake")
    require_tool("ninja")
    WASM_BUILD.mkdir(parents=True, exist_ok=True)
    alias_host_tools_for_emscripten(host_bin)

    llvm_tblgen = str(host_tool_path(host_bin, "llvm-tblgen").resolve())
    clang_tblgen = str(host_tool_path(host_bin, "clang-tblgen").resolve())
    native_dir = str(host_bin.resolve())

    cache = {
        **COMMON_LLVM_CACHE,
        **compiler_launcher_cache(),
        **native_cross_toolchain_flags(),
        "LLVM_NATIVE_TOOL_DIR": native_dir,
        "LLVM_HOST_EXECUTABLE_SUFFIX": "",
        "LLVM_TABLEGEN": llvm_tblgen,
        "CLANG_TABLEGEN": clang_tblgen,
        "LLVM_USE_HOST_TOOLS": "ON",
        "CMAKE_CXX_FLAGS": "-O3 -fno-exceptions",
        "CMAKE_C_FLAGS": "-O3",
        "CMAKE_EXE_LINKER_FLAGS": EMSCRIPTEN_LINK_FLAGS,
        "CMAKE_CROSSCOMPILING": "TRUE",
        "HAVE_POSIX_TIMERS": "0",
        "HAVE_FUTIMENS": "0",
    }
    run(
        [
            emcmake,
            "cmake",
            "-S",
            str(LLVM_DIR),
            "-B",
            str(WASM_BUILD),
            "-G",
            "Ninja",
            *cache_args(cache),
        ]
    )
    plant_nested_native_tools(host_bin)
    cmake_build(WASM_BUILD, ["clang"], jobs)


def copy_output() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    bin_dir = WASM_BUILD / "bin"
    js_src = bin_dir / "clang.js"
    wasm_src = bin_dir / "clang.wasm"
    if not js_src.is_file() or not wasm_src.is_file():
        found = (
            sorted(p.name for p in bin_dir.glob("clang*")) if bin_dir.is_dir() else []
        )
        raise SystemExit(
            f"Expected clang.js and clang.wasm in {bin_dir}, found: {found}"
        )
    shutil.copy2(js_src, OUTPUT_DIR / "clang.js")
    shutil.copy2(wasm_src, OUTPUT_DIR / "clang.wasm")
    js_size = (OUTPUT_DIR / "clang.js").stat().st_size
    wasm_size = (OUTPUT_DIR / "clang.wasm").stat().st_size
    print(f"Wrote {OUTPUT_DIR / 'clang.js'} ({js_size} bytes)")
    print(f"Wrote {OUTPUT_DIR / 'clang.wasm'} ({wasm_size} bytes)")


def reclaim_disk() -> None:
    for path in (HOST_BUILD, WASM_BUILD):
        if path.exists():
            print(f"Removing {path}")
            shutil.rmtree(path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--skip-download",
        action="store_true",
        help="Use the existing llvm-project checkout under .clang-wasm-build/",
    )
    parser.add_argument(
        "--skip-host",
        action="store_true",
        help="Reuse previously harvested host tblgen tools",
    )
    parser.add_argument(
        "--host-bin",
        type=Path,
        help="Directory containing native llvm-tblgen and clang-tblgen",
    )
    parser.add_argument(
        "--jobs",
        type=int,
        default=cpu_count(),
        help="Ninja parallelism for the host tblgen build",
    )
    parser.add_argument(
        "--wasm-jobs",
        type=int,
        default=max(1, min(2, cpu_count())),
        help="Ninja parallelism for the Emscripten clang build (keep low to limit RAM)",
    )
    parser.add_argument(
        "--reclaim-disk",
        action="store_true",
        help="Delete intermediate build trees after copying clang.js/wasm",
    )
    args = parser.parse_args()

    if not args.skip_download:
        download_llvm()
    elif not LLVM_DIR.is_dir():
        raise SystemExit(f"LLVM sources not found at {LLVM_DIR}")

    if args.host_bin:
        host_bin = args.host_bin
    elif args.skip_host:
        host_bin = HOST_BIN if HOST_BIN.is_dir() else HOST_BUILD / "bin"
    else:
        host_bin = None

    if host_bin is None or not host_bin_is_complete(host_bin):
        host_bin = build_host_tblgen(args.jobs)
        if HOST_BUILD.exists():
            print(f"Removing host object files at {HOST_BUILD}")
            shutil.rmtree(HOST_BUILD)
    else:
        alias_host_tools_for_emscripten(host_bin)

    build_emscripten_clang(host_bin, args.wasm_jobs)
    copy_output()
    if args.reclaim_disk:
        reclaim_disk()


if __name__ == "__main__":
    main()
