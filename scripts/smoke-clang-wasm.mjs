#!/usr/bin/env node
/**
 * Compile a tiny MIPS C snippet with the published Clang WASM.
 * Usage: node scripts/smoke-clang-wasm.mjs [path/to/clang.js]
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const jsPath = path.resolve(
  process.argv[2] || path.join("public", "clang", "clang.js"),
);
const wasmPath = path.join(path.dirname(jsPath), "clang.wasm");

if (!fs.existsSync(jsPath) || !fs.existsSync(wasmPath)) {
  console.error(`Missing Clang WASM at ${jsPath} / ${wasmPath}`);
  process.exit(2);
}

const { default: Clang } = await import(pathToFileURL(jsPath).href);

const errors = [];
const clang = await Clang({
  noInitialRun: true,
  noExitRuntime: true,
  print: (text) => errors.push(text),
  printErr: (text) => errors.push(text),
});

clang.FS.writeFile(
  "/input.c",
  "int add(int a, int b) { return a + b; }\nint *g;\nint use_g(void) { return *g; }\n",
);

// Keep in sync with CLANG_MIPS_ARGS in packages/lib/utils/c-compiler-clang.ts
const argv = [
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
  "-Wno-implicit-function-declaration",
  "-Wno-implicit-int",
  "-O2",
  "-S",
  "-o",
  "/output.s",
  "/input.c",
];

let status;
try {
  status = clang.callMain(argv);
} catch (e) {
  if (e && typeof e === "object" && "status" in e) {
    status = e.status;
  } else {
    console.error(e);
    process.exit(1);
  }
}

if (status !== 0) {
  console.error(errors.join("\n") || `clang exited ${status}`);
  process.exit(1);
}

const asm = clang.FS.readFile("/output.s", { encoding: "utf8" });
if (!asm.includes("addu") || !asm.includes("%hi(g)")) {
  console.error("Unexpected assembly:\n" + asm);
  process.exit(1);
}

console.log("Clang WASM smoke test passed.");
