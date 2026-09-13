const DROP_DIRECTIVE_RE =
  /^\s*\.(?:ident|file|nan|module|abicalls|noabicalls|option|previous|type|size|ent|end|frame|mask|fmask|set|cfi_\w+|addrsig(?:_sym)?|weak|local|hidden|protected|internal|eabi_attribute|gnu_attribute|glob(?:al|l))\b/;

const KEEP_DOT_DIRECTIVES =
  /^(?:text|data|rdata|bss|align|word|halfword|byte|asciiz|ascii|asciz|float|dw|dh|db|fill|skip|space|zero|org|orga)\b/i;

/** Turns ".str.4" into "str_4" so mips-assembler does not see a directive. */
function rewriteDottedLlvmSymbols(line: string): string {
  return line.replace(/(^|[^.\w])(\.[A-Za-z_][\w.$]*)/g, (full, prefix, ident) => {
    const body = ident.slice(1);
    if (KEEP_DOT_DIRECTIVES.test(body)) {
      return full;
    }
    return prefix + body.replace(/[.$]/g, "_");
  });
}

/**
 * LLVM MIPS private symbols look like "$.str" / "$BB0_2".
 * "$" is hex in mips-assembler, and leading "." looks like a directive.
 */
function rewriteLlvmSymbols(line: string): string {
  // LLVM local labels (".Ltmp0", ".L.str.4") look like directives.
  line = line.replace(/\.L([A-Za-z0-9_$.]+)/g, (_m, rest: string) => {
    return "L" + rest.replace(/[.$]/g, "_");
  });

  // Private LLVM symbols (".str", ".str.4") also start with ".".
  line = rewriteDottedLlvmSymbols(line);

  // LLVM basic-block / temp / string labels ("$BB0_2", "$.str").
  // Leave "$4" and named GPRs ("$zero") for convertToNamedRegisters.
  line = line.replace(
    /\$(?![0-9]+\b)(?!(?:zero|at|v[01]|a[0-3]|t[0-9]|s[0-8]|k[01]|gp|sp|fp|ra)\b)([A-Za-z_.][\w.]*)/gi,
    "$1",
  );

  line = line.replace(/%hi\(/g, "hi(");
  line = line.replace(/%lo\(/g, "lo(");
  line = line.replace(/%got\(/g, "hi(");
  line = line.replace(/%call16\(/g, "hi(");
  return line;
}

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

    // LLVM function-size labels; "$" is hex in mips-assembler.
    if (/^\$func_(?:end|begin)\d+\s*:/.test(trimmed)) {
      continue;
    }

    const fourByte = trimmed.match(/^\.(?:4byte|long)\s+(.+)$/);
    if (fourByte) {
      out.push(rewriteLlvmSymbols(".word " + fourByte[1].trim()));
      continue;
    }

    const twoByte = trimmed.match(/^\.(?:2byte|short)\s+(.+)$/);
    if (twoByte) {
      out.push(rewriteLlvmSymbols(".halfword " + twoByte[1].trim()));
      continue;
    }

    if (/^\.asciz\s+/.test(trimmed)) {
      out.push(rewriteLlvmSymbols(trimmed.replace(/^\.asciz\b/, ".asciiz")));
      continue;
    }

    const reserved = trimmed.match(/^\.(?:space|zero)\s+(\d+)/);
    if (reserved) {
      out.push(".skip " + reserved[1]);
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

    out.push(rewriteLlvmSymbols(raw));
  }

  return out.join("\n");
}
