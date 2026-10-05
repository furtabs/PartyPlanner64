import {
  createDefaultCProject,
  normalizeEventProject,
  resolveProjectInclude,
  packEventProject,
  unpackEventProject,
  getCEventExportText,
  DEFAULT_ENTRY_FILE,
} from "./eventproject";

describe("eventproject", () => {
  it("wraps legacy single-file code as src/main.c", () => {
    const files = normalizeEventProject("int main() { return 0; }");
    expect(files.src[DEFAULT_ENTRY_FILE]).toContain("int main");
    expect(files.include).toEqual({});
  });

  it("preserves existing project files", () => {
    const files = createDefaultCProject("// main");
    files.include["types.h"] = "typedef int s32;";
    const normalized = normalizeEventProject("// ignored", files);
    expect(normalized.src[DEFAULT_ENTRY_FILE]).toBe("// main");
    expect(normalized.include["types.h"]).toBe("typedef int s32;");
  });

  it("resolves includes from include/ then src/", () => {
    const files = createDefaultCProject("// main");
    files.include["foo.h"] = "int from_include;";
    files.src["bar.h"] = "int from_src;";
    expect(resolveProjectInclude("foo.h", files)).toBe("int from_include;");
    expect(resolveProjectInclude("bar.h", files)).toBe("int from_src;");
    expect(resolveProjectInclude("include/foo.h", files)).toBe(
      "int from_include;",
    );
    expect(resolveProjectInclude("missing.h", files)).toBeNull();
  });

  it("packs and unpacks multi-file projects via @@PP64_FILE breaks", () => {
    const files = createDefaultCProject(
      "// NAME: Demo\n#include \"types.h\"\nvoid main() {}",
    );
    files.include["types.h"] = "typedef int s32;";
    files.src["helpers.c"] = "s32 helper(void) { return 1; }";

    const packed = packEventProject(files);
    expect(packed).toContain("// @@PP64_FILE src/main.c");
    expect(packed).toContain("// @@PP64_FILE src/helpers.c");
    expect(packed).toContain("// @@PP64_FILE include/types.h");

    const unpacked = unpackEventProject(packed);
    expect(unpacked).not.toBeNull();
    expect(unpacked!.src[DEFAULT_ENTRY_FILE]).toContain("NAME: Demo");
    expect(unpacked!.src["helpers.c"]).toContain("helper");
    expect(unpacked!.include["types.h"]).toBe("typedef int s32;");
  });

  it("exports plain main.c when there are no extra files", () => {
    const code = "// NAME: Solo\nvoid main() {}";
    expect(getCEventExportText(code)).toBe(code);
  });

  it("normalizes packed export text into a project", () => {
    const packed = [
      "// @@PP64_FILE src/main.c",
      "// NAME: Packed",
      "void main() {}",
      "",
      "// @@PP64_FILE include/a.h",
      "#define A 1",
      "",
    ].join("\n");
    const files = normalizeEventProject(packed);
    expect(files.src[DEFAULT_ENTRY_FILE]).toContain("NAME: Packed");
    expect(files.include["a.h"]).toBe("#define A 1");
  });
});
