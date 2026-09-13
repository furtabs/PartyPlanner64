import {
  CLANG_MIPS_ARGS,
  clangUrlsForDir,
  resolvePublicAssetUrl,
} from "./c-compiler-clang";
import { sanitizeClangAssembly } from "./c-compiler-clang-asm";

describe("CLANG_MIPS_ARGS", () => {
  it("avoids -mllvm flags the WASM Clang does not register", () => {
    expect(CLANG_MIPS_ARGS).toContain("-mno-abicalls");
    expect(CLANG_MIPS_ARGS).toContain("-mno-gpopt");
    expect(CLANG_MIPS_ARGS).not.toContain("-G0");
    expect(CLANG_MIPS_ARGS).not.toContain("-mno-check-zero-division");
    expect(CLANG_MIPS_ARGS).not.toContain("-mgpopt");
    expect(CLANG_MIPS_ARGS).toContain("-Wno-implicit-function-declaration");
    expect(CLANG_MIPS_ARGS).not.toContain("-O2");
  });
});

describe("resolvePublicAssetUrl", () => {
  it("resolves Clang files against the page, not /assets/index-*.js", () => {
    expect(
      resolvePublicAssetUrl(
        "clang/clang.js",
        "./",
        "https://partyplannerclang.netlify.app/",
      ),
    ).toBe("https://partyplannerclang.netlify.app/clang/clang.js");
    expect(
      resolvePublicAssetUrl(
        "clang/clang.wasm",
        "./",
        "https://partyplannerclang.netlify.app/index.html",
      ),
    ).toBe("https://partyplannerclang.netlify.app/clang/clang.wasm");
  });

  it("keeps wasm next to whichever directory published clang.js", () => {
    expect(
      clangUrlsForDir(
        "assets/clang",
        "./",
        "https://partyplannerclang.netlify.app/",
      ),
    ).toEqual({
      jsUrl: "https://partyplannerclang.netlify.app/assets/clang/clang.js",
      wasmUrl: "https://partyplannerclang.netlify.app/assets/clang/clang.wasm",
    });
    expect(
      clangUrlsForDir(
        "clang",
        "./",
        "https://partyplanner64.github.io/PartyPlanner64/",
      ),
    ).toEqual({
      jsUrl: "https://partyplanner64.github.io/PartyPlanner64/clang/clang.js",
      wasmUrl: "https://partyplanner64.github.io/PartyPlanner64/clang/clang.wasm",
    });
  });
});

describe("sanitizeClangAssembly", () => {
  it("drops LLVM metadata directives and keeps instructions", () => {
    const input = `
	.text
	.file	"input.c"
	.globl	main
	.align	2
	.type	main,@function
	.ent	main
main:
	.frame	$sp,24,$ra
	.set	noreorder
	addiu	$sp, $sp, -24
	sw	$ra, 20($sp)
	jal	.Ltmp0
	nop
	.end	main
	.size	main, .-main
`;
    const result = sanitizeClangAssembly(input);
    expect(result).toContain(".text");
    expect(result).not.toContain(".globl");
    expect(result).toContain("main:");
    expect(result).toContain("addiu");
    expect(result).not.toContain(".file");
    expect(result).not.toContain(".ent");
    expect(result).not.toContain(".set");
    expect(result).toContain("Ltmp0");
    expect(result).not.toMatch(/\.Ltmp0/);
  });

  it("converts %hi/%lo and .rodata sections", () => {
    const input = `
	.section	.rodata.str1.1,"aMS",@progbits,1
msg:
	.asciiz	"hi"
	.text
	lui	$4, %hi(msg)
	addiu	$4, $4, %lo(msg)
`;
    const result = sanitizeClangAssembly(input);
    expect(result).toContain(".rdata");
    expect(result).toContain("hi(msg)");
    expect(result).toContain("lo(msg)");
    expect(result).not.toContain("%hi");
  });

  it("drops .globl and rewrites LLVM data directives for mips-assembler", () => {
    const input = `
	.globl	main
	.globl	g
main:
	jr	$ra
$func_end0:
	.size	main, $func_end0-main
	.bss
	.globl	g
	.p2align	2, 0x0
g:
	.4byte	0
	.asciz	"hi"
`;
    const result = sanitizeClangAssembly(input);
    expect(result).not.toContain(".globl");
    expect(result).not.toContain("$func_end0");
    expect(result).toContain(".word 0");
    expect(result).not.toContain(".4byte");
    expect(result).toContain(".asciiz");
    expect(result).not.toContain(".asciz");
  });

  it("rewrites $BB labels so mips-assembler does not treat them as hex", () => {
    const input = `
	bnez	$1, $BB0_2
	nop
$BB0_2:
	beq	$1, $0, $BB0_4
$BB0_4:
	jr	$ra
`;
    const result = sanitizeClangAssembly(input);
    expect(result).toContain("BB0_2");
    expect(result).toContain("BB0_4");
    expect(result).not.toMatch(/\$BB/);
    expect(result).toMatch(/\$1/);
    expect(result).toMatch(/\$0/);
  });

  it("rewrites .str.N labels used by LLVM string constants", () => {
    const input = `
	lui	$1, %hi(.str.4)
	addiu	$4, $1, %lo(.str.4)
.str.4:
	.asciiz	"hello"
.str:
	.asciiz	"x"
`;
    const result = sanitizeClangAssembly(input);
    expect(result).toContain("hi(str_4)");
    expect(result).toContain("lo(str_4)");
    expect(result).toContain("str_4:");
    expect(result).toContain("str:");
    expect(result).not.toMatch(/\.str/);
    expect(result).toContain(".asciiz");
  });

  it("rewrites .4byte $.str pointer initializers used by LLVM", () => {
    const input = `
$.str:
	.asciz	"hello"
	.size	$.str, 6
msg:
	.4byte	$.str
$.str.1:
	.asciz	"world"
msg2:
	.4byte	$.str.1
`;
    const result = sanitizeClangAssembly(input);
    expect(result).toContain("str:");
    expect(result).toContain("str_1:");
    expect(result).toContain(".word str");
    expect(result).toContain(".word str_1");
    expect(result).not.toMatch(/\$\.str/);
    expect(result).not.toContain(".4byte");
    expect(result).toContain('.asciiz "hello"');
  });

  it("converts .space/.zero BSS reservations to .skip", () => {
    const input = `
price:
	.space	16
turnPrice:
	.zero	16
`;
    const result = sanitizeClangAssembly(input);
    expect(result).toContain("price:");
    expect(result).toContain("turnPrice:");
    expect(result).toContain(".skip 16");
    expect(result).not.toMatch(/^\s*space\s/m);
    expect(result).not.toContain(".space");
    expect(result).not.toContain(".zero");
  });
});
