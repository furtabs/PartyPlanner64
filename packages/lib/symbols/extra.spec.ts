import { Game } from "../types";
import {
  getExtraSymbols,
  loadExtraSymbolSources,
  parseExtraSymbolSources,
  writeInlineSymbolFile,
} from "./extra";

describe("parseExtraSymbolSources", () => {
  it("returns an empty list for invalid values", () => {
    expect(parseExtraSymbolSources(undefined)).toEqual([]);
    expect(parseExtraSymbolSources("nope")).toEqual([]);
    expect(parseExtraSymbolSources([{ path: "only-path" }])).toEqual([]);
  });

  it("keeps well-formed sources", () => {
    expect(
      parseExtraSymbolSources([
        {
          id: "a",
          path: "https://example.com/MarioParty3U.sym",
          kind: "decomp",
          game: Game.MP3_USA,
        },
      ]),
    ).toEqual([
      {
        id: "a",
        path: "https://example.com/MarioParty3U.sym",
        kind: "decomp",
        game: Game.MP3_USA,
      },
    ]);
  });
});

describe("loadExtraSymbolSources", () => {
  it("loads inline CSV into the extra symbol table", async () => {
    const id = "inline-mp3";
    writeInlineSymbolFile(
      id,
      "80012345,code,huPrcInit,process init\n80012348,code,?skip",
    );
    await loadExtraSymbolSources([
      {
        id,
        path: "MarioParty3U.decomp.sym",
        kind: "decomp",
        inline: true,
        game: Game.MP3_USA,
      },
    ]);
    expect(getExtraSymbols(Game.MP3_USA).map((symbol) => symbol.name)).toEqual([
      "huPrcInit",
    ]);
    expect(getExtraSymbols(Game.MP1_USA)).toEqual([]);
  });

  it("loads splat symbol_addrs.txt into the extra symbol table", async () => {
    const id = "inline-splat";
    writeInlineSymbolFile(
      id,
      "Hu3DCamInit = 0x80012220;\nD_800CE204 = 0x800CE204; //type:s16\n",
    );
    await loadExtraSymbolSources([
      {
        id,
        path: "https://github.com/mariopartyrd/marioparty3/blob/main/symbol_addrs.txt",
        kind: "decomp",
        inline: true,
        game: Game.MP3_USA,
      },
    ]);
    expect(getExtraSymbols(Game.MP3_USA).map((symbol) => symbol.name)).toEqual([
      "Hu3DCamInit",
      "D_800CE204",
    ]);
  });
});
