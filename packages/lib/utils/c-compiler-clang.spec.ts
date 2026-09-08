import { sanitizeClangAssembly } from "./c-compiler-clang-asm";

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
    expect(result).toContain(".globl main");
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
});
