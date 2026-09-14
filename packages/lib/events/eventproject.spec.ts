import {
  createDefaultCProject,
  normalizeEventProject,
  resolveProjectInclude,
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
});
