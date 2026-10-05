import { Game } from "../types";
import {
  inferGameFromSymbolPath,
  parseSymFile,
  symbolPathBasename,
  toFetchableSymbolUrl,
} from "./parse";

describe("parseSymFile", () => {
  it("parses addr,type,name[,desc] CSV rows", () => {
    const text = [
      "80000300,u32,osTvType,0=PAL",
      "80009C10,code,ReadMainFS,Reads file from MainFS",
      "8000A230,code,DecodeNone",
    ].join("\n");
    expect(parseSymFile(text)).toEqual([
      {
        addr: 0x80000300,
        type: "u32",
        name: "osTvType",
        desc: "0=PAL",
      },
      {
        addr: 0x80009c10,
        type: "code",
        name: "ReadMainFS",
        desc: "Reads file from MainFS",
      },
      { addr: 0x8000a230, type: "code", name: "DecodeNone" },
    ]);
  });

  it("accepts 0x prefixes, comments, and commas in the description", () => {
    const text = [
      "# header",
      "// also a comment",
      "",
      "0x80012345,code,huPrcInit,hello, world",
    ].join("\n");
    expect(parseSymFile(text)).toEqual([
      {
        addr: 0x80012345,
        type: "code",
        name: "huPrcInit",
        desc: "hello, world",
      },
    ]);
  });

  it("skips iffy names the same way update-symbols.js does", () => {
    const text = [
      "80000000,code,goodName",
      "80000004,code,?guess",
      "80000008,code,guess?",
    ].join("\n");
    expect(parseSymFile(text).map((s) => s.name)).toEqual(["goodName"]);
  });

  it("parses splat symbol_addrs.txt lines", () => {
    const text = [
      "//chancetime",
      "alCSPGetChlVol = 0x8006CFF0;",
      "omVibrate = 0x8004B25C; //rom:0x4BE5C",
      "D_800CE204 = 0x800CE204; //type:s16",
      "D_800A46A0 = 0x800A46A0; //size:0x190 type:f32",
      "Hu3DCamInit = 0x80012220;",
    ].join("\n");
    expect(parseSymFile(text)).toEqual([
      { addr: 0x8006cff0, type: "code", name: "alCSPGetChlVol" },
      {
        addr: 0x8004b25c,
        type: "code",
        name: "omVibrate",
        desc: "rom:0x4BE5C",
      },
      {
        addr: 0x800ce204,
        type: "s16",
        name: "D_800CE204",
        desc: "type:s16",
      },
      {
        addr: 0x800a46a0,
        type: "f32",
        name: "D_800A46A0",
        desc: "size:0x190 type:f32",
      },
      { addr: 0x80012220, type: "code", name: "Hu3DCamInit" },
    ]);
  });
});

describe("inferGameFromSymbolPath", () => {
  it("matches MarioParty3U.sym and decomp-style filenames", () => {
    expect(inferGameFromSymbolPath("MarioParty3U.sym")).toBe(Game.MP3_USA);
    expect(inferGameFromSymbolPath("MarioParty3U.decomp.sym")).toBe(
      Game.MP3_USA,
    );
    expect(inferGameFromSymbolPath("MarioParty2J.sym")).toBe(Game.MP2_JPN);
    expect(inferGameFromSymbolPath("MarioParty1E.sym")).toBe(Game.MP1_PAL);
  });

  it("matches a GitHub blob URL", () => {
    expect(
      inferGameFromSymbolPath(
        "https://github.com/PartyPlanner64/symbols/blob/master/MarioParty3U.sym",
      ),
    ).toBe(Game.MP3_USA);
  });

  it("matches mariopartyrd decomp repo URLs as NTSC-U", () => {
    expect(
      inferGameFromSymbolPath(
        "https://github.com/mariopartyrd/marioparty3/blob/main/symbol_addrs.txt",
      ),
    ).toBe(Game.MP3_USA);
    expect(
      inferGameFromSymbolPath(
        "https://github.com/mariopartyrd/marioparty2/blob/master/symbol_addrs.txt",
      ),
    ).toBe(Game.MP2_USA);
    expect(
      inferGameFromSymbolPath(
        "https://github.com/mariopartyrd/marioparty/blob/master/symbol_addrs.txt",
      ),
    ).toBe(Game.MP1_USA);
  });
});

describe("toFetchableSymbolUrl", () => {
  it("converts GitHub blob pages to raw.githubusercontent.com", () => {
    expect(
      toFetchableSymbolUrl(
        "https://github.com/PartyPlanner64/symbols/blob/master/MarioParty3U.sym",
      ),
    ).toBe(
      "https://raw.githubusercontent.com/PartyPlanner64/symbols/master/MarioParty3U.sym",
    );
    expect(
      toFetchableSymbolUrl(
        "https://github.com/mariopartyrd/marioparty3/blob/main/symbol_addrs.txt",
      ),
    ).toBe(
      "https://raw.githubusercontent.com/mariopartyrd/marioparty3/main/symbol_addrs.txt",
    );
  });

  it("leaves already-raw URLs alone", () => {
    const raw =
      "https://raw.githubusercontent.com/PartyPlanner64/symbols/master/MarioParty3U.sym";
    expect(toFetchableSymbolUrl(raw)).toBe(raw);
  });
});

describe("symbolPathBasename", () => {
  it("returns the filename from a URL", () => {
    expect(
      symbolPathBasename(
        "https://github.com/PartyPlanner64/symbols/blob/master/MarioParty3U.sym",
      ),
    ).toBe("MarioParty3U.sym");
  });
});
