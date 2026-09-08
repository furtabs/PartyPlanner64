const DROP_DIRECTIVE_RE =
  /^\s*\.(?:ident|file|nan|module|abicalls|noabicalls|option|previous|type|size|ent|end|frame|mask|fmask|set|cfi_\w+|addrsig(?:_sym)?|weak|local|hidden|protected|internal|eabi_attribute|gnu_attribute)\b/;

function rewriteAlign(trimmed: string): string | null {
  const p2 = trimmed.match(/^\.p2align\s+(\d+)/);
  if (p2) {
    return ".align " + Math.pow(2, parseInt(p2[1], 10));
  }
  const align = trimmed.match(/^\.align\s+(\d+)/);
  if (align) {
    const n = parseInt(align[1], 10);
    // GAS/LLVM MIPS `.align 2` means 2^2 bytes.
    return ".align " + (n <= 3 ? Math.pow(2, n) : n);
  }
  return null;
}

/**
 * Rewrites LLVM/Clang MIPS assembly into a form mips-assembler accepts.
 */
export function sanitizeClangAssembly(assembly: string): string {
  const lines = assembly.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];

  for (let raw of lines) {
    raw = raw.replace(/\t/g, " ");
    raw = raw.replace(/\s+#\s.*$/, "");

    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) {
      continue;
    }

    if (/^\.section\s/.test(trimmed)) {
      const section = trimmed.toLowerCase();
      if (section.includes(".text")) {
        out.push(".text");
      } else if (section.includes(".rodata") || section.includes(".rdata")) {
        out.push(".rdata");
      } else if (section.includes(".data")) {
        out.push(".data");
      } else if (section.includes(".bss")) {
        out.push(".bss");
      }
      continue;
    }

    const globl = trimmed.match(/^\.glob(?:al|l)\s+(.+)$/);
    if (globl) {
      out.push(".globl " + globl[1].trim());
      continue;
    }

    const aligned = rewriteAlign(trimmed);
    if (aligned) {
      out.push(aligned);
      continue;
    }

    if (DROP_DIRECTIVE_RE.test(trimmed)) {
      continue;
    }

    if (/^\.comm\s+/.test(trimmed) || /^\.lcomm\s+/.test(trimmed)) {
      const match = trimmed.match(/^\.(?:l)?comm\s+([^,]+),\s*(\d+)/);
      if (match) {
        const size = parseInt(match[2], 10);
        out.push(".bss");
        out.push(match[1].replace(/^\./, "") + ":");
        const words = Math.max(1, Math.ceil(size / 4));
        for (let i = 0; i < words; i++) {
          out.push(".word 0");
        }
      }
      continue;
    }

    let line = raw;

    // LLVM local labels (".Ltmp0") look like directives to mips-assembler.
    line = line.replace(/\.L([A-Za-z0-9_$.]+)/g, "L$1");

    line = line.replace(/%hi\(/g, "hi(");
    line = line.replace(/%lo\(/g, "lo(");
    line = line.replace(/%got\(/g, "hi(");
    line = line.replace(/%call16\(/g, "hi(");

    out.push(line);
  }

  return out.join("\n");
}
