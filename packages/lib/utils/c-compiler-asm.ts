const regNames = [
  ["r0", "$0"],
  ["at", "$1"],
  ["v0", "$2"],
  ["v1", "$3"],
  ["a0", "$4"],
  ["a1", "$5"],
  ["a2", "$6"],
  ["a3", "$7"],
  ["t0", "$8"],
  ["t1", "$9"],
  ["t2", "$10"],
  ["t3", "$11"],
  ["t4", "$12"],
  ["t5", "$13"],
  ["t6", "$14"],
  ["t7", "$15"],
  ["s0", "$16"],
  ["s1", "$17"],
  ["s2", "$18"],
  ["s3", "$19"],
  ["s4", "$20"],
  ["s5", "$21"],
  ["s6", "$22"],
  ["s7", "$23"],
  ["t8", "$24"],
  ["t9", "$25"],
  ["k0", "$26"],
  ["k1", "$27"],
  ["gp", "$28"],
  ["sp", "$29"],
  ["fp", "$30"],
  ["ra", "$31"],
];

const namedDollarRegs: Array<[string, string]> = [
  ["r0", "zero"],
  ["at", "at"],
  ["v0", "v0"],
  ["v1", "v1"],
  ["a0", "a0"],
  ["a1", "a1"],
  ["a2", "a2"],
  ["a3", "a3"],
  ["t0", "t0"],
  ["t1", "t1"],
  ["t2", "t2"],
  ["t3", "t3"],
  ["t4", "t4"],
  ["t5", "t5"],
  ["t6", "t6"],
  ["t7", "t7"],
  ["s0", "s0"],
  ["s1", "s1"],
  ["s2", "s2"],
  ["s3", "s3"],
  ["s4", "s4"],
  ["s5", "s5"],
  ["s6", "s6"],
  ["s7", "s7"],
  ["t8", "t8"],
  ["t9", "t9"],
  ["k0", "k0"],
  ["k1", "k1"],
  ["gp", "gp"],
  ["sp", "sp"],
  ["fp", "fp"],
  ["fp", "s8"],
  ["ra", "ra"],
];

export function convertToNamedRegisters(assembly: string): string {
  for (const [dest, src] of namedDollarRegs) {
    assembly = assembly.replace(new RegExp("\\$" + src + "\\b", "gi"), dest);
  }
  // Backwards to replace $31 before $3
  for (let i = regNames.length - 1; i >= 0; i--) {
    assembly = assembly.replace(
      new RegExp("\\" + regNames[i][1] + "\\b", "g"),
      regNames[i][0],
    );
  }
  return assembly;
}

interface ISectionStrings {
  text: string[];
  data: string[];
  rdata: string[];
  bss: string[];
}

/**
 * The compiler emits each section in fragments.
 * They need to be fused into one, otherwise some labels could be broken.
 */
export function fuseSections(assembly: string): string {
  const sections: ISectionStrings = {
    text: [],
    data: [],
    rdata: [],
    bss: [],
  };

  let curSection: keyof ISectionStrings = "text";

  assembly.split("\n").forEach((line) => {
    switch (line.trim()) {
      case ".text":
        curSection = "text";
        break;
      case ".data":
        curSection = "data";
        break;
      case ".rdata":
        curSection = "rdata";
        break;
      case ".bss":
        curSection = "bss";
        break;
      default:
        sections[curSection].push(line);
        break;
    }
  });

  return `; .text
${sections.text.join("\n")}
; .data
${sections.data.join("\n")}
; .rdata
${sections.rdata.join("\n")}
; .bss
${sections.bss.join("\n")}`;
}

// The compiler implements soft float operations.

const __floatsisf = `__floatsisf:
__floatunsisf:
  mtc1 A0, F12
  cvt.s.w F12, F12
  mfc1 V0, F12
  JR RA
  NOP`;

const __fixsfsi = `__fixsfsi:
__fixunssfsi:
  mtc1 A0, F12
  cvt.w.s F12, F12
  mfc1 V0, F12
  JR RA
  NOP`;

const __addsf3 = `__addsf3:
  mtc1 A0, F12
  mtc1 A1, F13
  add.s F12, F12, F13
  mfc1 V0, F12
  JR RA
  NOP`;

const __subsf3 = `__subsf3:
  mtc1 A0, F12
  mtc1 A1, F13
  sub.s F12, F12, F13
  mfc1 V0, F12
  JR RA
  NOP`;

const __negsf2 = `__negsf2:
  mtc1 A0, F12
  neg.s F12, F12
  mfc1 V0, F12
  JR RA
  NOP`;

const __mulsf3 = `__mulsf3:
  mtc1 A0, F12
  mtc1 A1, F13
  mul.s F12, F12, F13
  mfc1 V0, F12
  JR RA
  NOP`;

const __divsf3 = `__divsf3:
  mtc1 A0, F12
  mtc1 A1, F13
  div.s F12, F12, F13
  mfc1 V0, F12
  JR RA
  NOP`;

// return +1 if either a or b (or both) is a NaN (TODO)
// return 0 if a == b
// return -1 if a < b
// return +1 if a > b
const __lesf2 = `__lesf2:
  mtc1 A0, F12
  mtc1 A1, F13

  c.eq.s F12, F13
  bc1t __lesf2_ret ; a == b
  li V0, 0

  c.lt.s F12, F13
  li V0, -1 ; a < b
  bc1t __lesf2_ret
  nop

  li V0, 1 ; a > b

  mfc1 V0, F12
__lesf2_ret:
  JR RA
  NOP`;

// return -1 if either a or b (or both) is a NaN (TODO)
// return 0 if a == b
// return -1 if a < b
// return +1 if a > b
const __gesf2 = `__gesf2:
  mtc1 A0, F12
  mtc1 A1, F13

  c.eq.s F12, F13
  bc1t __gesf2_ret ; a == b
  li V0, 0

  c.lt.s F12, F13
  li V0, -1 ; a < b
  bc1t __gesf2_ret
  nop

  li V0, 1 ; a > b

  mfc1 V0, F12
__gesf2_ret:
  JR RA
  NOP`;

export function includeFloatHelpers(assembly: string): string {
  let floatOps = "";

  if (assembly.indexOf("__floatsisf") >= 0) floatOps += "\n" + __floatsisf;
  if (assembly.indexOf("__floatunsisf") >= 0) floatOps += "\n" + __floatsisf;
  if (assembly.indexOf("__fixsfsi") >= 0) floatOps += "\n" + __fixsfsi;
  if (assembly.indexOf("__fixunssfsi") >= 0) floatOps += "\n" + __fixsfsi;
  if (assembly.indexOf("__addsf3") >= 0) floatOps += "\n" + __addsf3;
  if (assembly.indexOf("__subsf3") >= 0) floatOps += "\n" + __subsf3;
  if (assembly.indexOf("__negsf2") >= 0) floatOps += "\n" + __negsf2;
  if (assembly.indexOf("__mulsf3") >= 0) floatOps += "\n" + __mulsf3;
  if (assembly.indexOf("__divsf3") >= 0) floatOps += "\n" + __divsf3;
  if (assembly.indexOf("__lesf2") >= 0) floatOps += "\n" + __lesf2;
  if (assembly.indexOf("__gesf2") >= 0) floatOps += "\n" + __gesf2;

  if (floatOps) {
    assembly += "\n; .text\n.align 4\n" + floatOps.trim();
  }

  return assembly;
}
