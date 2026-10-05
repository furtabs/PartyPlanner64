import * as React from "react";
import { addBoard } from "../boards";
import { showMessage, changeView } from "../appControl";
import { View } from "../../../packages/lib/types";
import "../css/boardbrowser.scss";

const API_BASE = "https://ppapi.tabs.gay";
const PAGE_SIZE = 20;
const ENRICH_CONCURRENCY = 8;
const CACHE_TTL_MS = 5 * 60 * 1000;

interface BoardListItem {
  id: string;
  name: string;
  author?: string;
  icon?: string;
  gameId?: number;
}

interface BoardDetails {
  id?: number | string;
  name?: string;
  author?: string;
  icon?: string;
  description?: string;
  difficulty?: number;
  recommended_turns?: number;
  custom_events?: number;
  custom_music?: number;
  creation_date?: string;
  theme?: string;
  space_count?: number;
  error?: boolean;
}

interface BoardVersion {
  file_id: string;
  file_version: string;
  release_date?: string;
  download_count?: string | number;
  download_link: string;
  file_name?: string;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const EMPTY_BOARDS: BoardListItem[] = [];

const topListCache = new Map<number, CacheEntry<BoardListItem[]>>();
const searchCache = new Map<string, CacheEntry<BoardListItem[]>>();
const detailsCache = new Map<string, CacheEntry<BoardDetails>>();
const versionsCache = new Map<string, CacheEntry<BoardVersion[]>>();
const detailsInflight = new Map<string, Promise<BoardDetails>>();
const versionsInflight = new Map<string, Promise<BoardVersion[]>>();
const topInflight = new Map<number, Promise<BoardListItem[]>>();
const searchInflight = new Map<string, Promise<BoardListItem[]>>();

function cacheGet<T>(map: Map<string | number, CacheEntry<T>>, key: string | number): T | undefined {
  const entry = map.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    map.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheSet<T>(
  map: Map<string | number, CacheEntry<T>>,
  key: string | number,
  value: T,
): void {
  map.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function boardId(raw: any): string {
  const id = raw?.id ?? raw?.projectId;
  return id == null ? "" : String(id);
}

function normalizeListItem(raw: any): BoardListItem | null {
  const id = boardId(raw);
  if (!id) return null;
  return {
    id,
    name: raw.name || `Board ${id}`,
    author: raw.author || raw.creator,
    icon: raw.icon,
    gameId: typeof raw.gameId === "number" ? raw.gameId : undefined,
  };
}

function normalizeList(raw: any[]): BoardListItem[] {
  return raw
    .map(normalizeListItem)
    .filter((item): item is BoardListItem => !!item);
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString();
}

function renderStars(starRank: unknown): string {
  const n = Math.max(0, Math.min(5, Number(starRank)));
  if (!Number.isFinite(n) || n <= 0) return "—";
  return "★".repeat(n) + "☆".repeat(5 - n);
}

function gameLabel(gameId?: number): string {
  if (gameId === 1) return "MP1";
  if (gameId === 2) return "MP2";
  if (gameId === 3) return "MP3";
  return "";
}

function resolveIconUrl(icon?: string): string | undefined {
  if (!icon) return undefined;
  return icon.startsWith("/") ? `${API_BASE}${icon}` : icon;
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }
  const runners = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    () => run(),
  );
  await Promise.all(runners);
  return results;
}

async function fetchTopBoards(
  max: number,
  signal?: AbortSignal,
): Promise<BoardListItem[]> {
  const cached = cacheGet(topListCache, max);
  if (cached) return cached;

  const existing = topInflight.get(max);
  if (existing) return existing;

  const promise = fetchJson<any[]>(
    `${API_BASE}/project/top?max=${max}`,
    signal,
  )
    .then((raw) => {
      const next = normalizeList(raw);
      cacheSet(topListCache, max, next);
      return next;
    })
    .finally(() => {
      topInflight.delete(max);
    });

  topInflight.set(max, promise);
  return promise;
}

async function fetchSearchBoards(
  term: string,
  signal?: AbortSignal,
): Promise<BoardListItem[]> {
  const key = term.toLowerCase();
  const cached = cacheGet(searchCache, key);
  if (cached) return cached;

  const existing = searchInflight.get(key);
  if (existing) return existing;

  const promise = fetchJson<any[]>(
    `${API_BASE}/project/search?searchTerm=${encodeURIComponent(term)}`,
    signal,
  )
    .then((raw) => {
      const next = normalizeList(raw);
      cacheSet(searchCache, key, next);
      return next;
    })
    .finally(() => {
      searchInflight.delete(key);
    });

  searchInflight.set(key, promise);
  return promise;
}

async function fetchBoardDetails(
  id: string,
  signal?: AbortSignal,
): Promise<BoardDetails> {
  const cached = cacheGet(detailsCache, id);
  if (cached) return cached;

  const existing = detailsInflight.get(id);
  if (existing) return existing;

  const promise = fetchJson<BoardDetails>(`${API_BASE}/project/${id}`, signal)
    .then((data) => {
      cacheSet(detailsCache, id, data);
      return data;
    })
    .catch((err) => {
      if ((err as Error)?.name === "AbortError") throw err;
      const failed: BoardDetails = { error: true };
      cacheSet(detailsCache, id, failed);
      return failed;
    })
    .finally(() => {
      detailsInflight.delete(id);
    });

  detailsInflight.set(id, promise);
  return promise;
}

async function fetchBoardVersions(
  id: string,
  signal?: AbortSignal,
): Promise<BoardVersion[]> {
  const cached = cacheGet(versionsCache, id);
  if (cached) return cached;

  const existing = versionsInflight.get(id);
  if (existing) return existing;

  const promise = fetchJson<{ versions?: BoardVersion[] }>(
    `${API_BASE}/project/${id}/files`,
    signal,
  )
    .then((data) => {
      const next = data.versions || [];
      cacheSet(versionsCache, id, next);
      return next;
    })
    .finally(() => {
      versionsInflight.delete(id);
    });

  versionsInflight.set(id, promise);
  return promise;
}

function hydrateDetailsFromCache(
  items: BoardListItem[],
): Record<string, BoardDetails> {
  const hydrated: Record<string, BoardDetails> = {};
  for (const item of items) {
    const cached = cacheGet(detailsCache, item.id);
    if (cached) hydrated[item.id] = cached;
  }
  return hydrated;
}

function Spinner({ label }: { label?: string }) {
  return (
    <div className="boardBrowserSpinner" role="status" aria-live="polite">
      <div className="boardBrowserSpinnerMark" />
      {label && <span>{label}</span>}
    </div>
  );
}

const BoardBrowserPage: React.FC = () => {
  const [boards, setBoards] = React.useState<BoardListItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [searchTerm, setSearchTerm] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [searching, setSearching] = React.useState(false);
  const [searchResults, setSearchResults] = React.useState<
    BoardListItem[] | null
  >(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [details, setDetails] = React.useState<Record<string, BoardDetails>>(
    {},
  );
  const [latestDates, setLatestDates] = React.useState<Record<string, string>>(
    {},
  );
  const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement>(null);
  const enrichmentControllerRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSearch(searchTerm.trim()),
      280,
    );
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const isSearching = debouncedSearch.length > 0;
  const boardsToShow = isSearching ? searchResults ?? EMPTY_BOARDS : boards;
  const selectedBoard =
    (selectedId &&
      (boardsToShow.find((board) => board.id === selectedId) ||
        boards.find((board) => board.id === selectedId) ||
        searchResults?.find((board) => board.id === selectedId))) ||
    null;

  const detailsRef = React.useRef(details);
  detailsRef.current = details;
  const selectedIdRef = React.useRef(selectedId);
  selectedIdRef.current = selectedId;
  const boardsToShowRef = React.useRef(boardsToShow);
  boardsToShowRef.current = boardsToShow;

  const pauseEnrichment = React.useCallback(() => {
    enrichmentControllerRef.current?.abort();
    enrichmentControllerRef.current = null;
  }, []);

  const loadEnrichment = React.useCallback(
    async (items: BoardListItem[]) => {
      // Don't contend with the selected board's /files request.
      if (selectedIdRef.current) return;

      const missing = items.filter((item) => !detailsRef.current[item.id]);
      if (!missing.length) return;

      pauseEnrichment();
      const controller = new AbortController();
      enrichmentControllerRef.current = controller;

      const batch: Record<string, BoardDetails> = {};
      let pending = 0;
      const flush = () => {
        if (!pending) return;
        const chunk = { ...batch };
        for (const key of Object.keys(chunk)) {
          delete batch[key];
        }
        pending = 0;
        setDetails((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const [id, data] of Object.entries(chunk)) {
            if (!next[id]) {
              next[id] = data;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      };

      await mapPool(missing, ENRICH_CONCURRENCY, async (item) => {
        if (controller.signal.aborted || selectedIdRef.current) return null;
        try {
          const data = await fetchBoardDetails(item.id, controller.signal);
          if (controller.signal.aborted) return null;
          batch[item.id] = data;
          pending++;
          if (pending >= 4) flush();
        } catch (err) {
          if ((err as Error)?.name === "AbortError") return null;
        }
        return null;
      });

      if (!controller.signal.aborted) {
        flush();
      }

      if (enrichmentControllerRef.current === controller) {
        enrichmentControllerRef.current = null;
      }
    },
    [pauseEnrichment],
  );

  const prefetchBoard = React.useCallback((id: string) => {
    void fetchBoardDetails(id);
    void fetchBoardVersions(id);
  }, []);

  const handleLastUpdated = React.useCallback((id: string, date: string) => {
    setLatestDates((prev) =>
      prev[id] === date ? prev : { ...prev, [id]: date },
    );
  }, []);

  // Pause background enrichment while a board modal needs the network.
  React.useEffect(() => {
    if (selectedId) {
      pauseEnrichment();
      void fetchBoardDetails(selectedId).then((data) => {
        setDetails((prev) =>
          prev[selectedId] === data ? prev : { ...prev, [selectedId]: data },
        );
      });
      void fetchBoardVersions(selectedId);
      return;
    }
    void loadEnrichment(boardsToShowRef.current);
  }, [selectedId, pauseEnrichment, loadEnrichment]);

  // Top boards list
  React.useEffect(() => {
    if (isSearching) return;
    const controller = new AbortController();

    const cached = cacheGet(topListCache, visibleCount);
    if (cached) {
      setBoards(cached);
      setDetails((prev) => ({ ...hydrateDetailsFromCache(cached), ...prev }));
      setLoading(false);
      setLoadingMore(false);
      void loadEnrichment(cached);
    } else if (visibleCount === PAGE_SIZE) {
      setLoading(true);
    }

    setError(null);
    fetchTopBoards(visibleCount, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setBoards(next);
        setDetails((prev) => ({ ...hydrateDetailsFromCache(next), ...prev }));
        setLoading(false);
        setLoadingMore(false);
        void loadEnrichment(next);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setError("Failed to load boards.");
        setLoading(false);
        setLoadingMore(false);
      });
    return () => controller.abort();
  }, [visibleCount, isSearching, loadEnrichment]);

  // Search
  React.useEffect(() => {
    if (!isSearching) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    const cached = cacheGet(searchCache, debouncedSearch.toLowerCase());
    if (cached) {
      setSearchResults(cached);
      setDetails((prev) => ({ ...hydrateDetailsFromCache(cached), ...prev }));
      setSearching(false);
      void loadEnrichment(cached);
    } else {
      setSearching(true);
    }
    setError(null);
    fetchSearchBoards(debouncedSearch, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setSearchResults(next);
        setDetails((prev) => ({ ...hydrateDetailsFromCache(next), ...prev }));
        setSearching(false);
        void loadEnrichment(next);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setError("Failed to search boards.");
        setSearching(false);
      });
    return () => controller.abort();
  }, [debouncedSearch, isSearching, loadEnrichment]);

  // Infinite scroll for top list only
  React.useEffect(() => {
    const el = listRef.current;
    if (!el || isSearching) return;
    const onScroll = () => {
      if (loadingMore || loading) return;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
        setLoadingMore(true);
        setVisibleCount((count) => count + PAGE_SIZE);
      }
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [isSearching, loadingMore, loading]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && selectedId) {
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId]);

  const busy = isSearching ? searching : loading && boards.length === 0;

  return (
    <div className="boardBrowserPage">
      <div className="boardBrowserTopBar">
        <div className="boardBrowserTitle">Browse boards</div>
        <div className="boardBrowserSearch">
          <input
            type="search"
            placeholder="Search by name…"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setSelectedId(null);
            }}
            autoFocus
            aria-label="Search boards"
          />
          {searchTerm && (
            <button
              type="button"
              className="boardBrowserClearSearch"
              onClick={() => setSearchTerm("")}
              title="Clear search"
            >
              Clear
            </button>
          )}
        </div>
        <div className="boardBrowserTopMeta">
          {isSearching
            ? searching
              ? "Searching…"
              : `${boardsToShow.length} result${boardsToShow.length === 1 ? "" : "s"}`
            : loading && !boards.length
              ? "Loading…"
              : `${boardsToShow.length} boards`}
        </div>
      </div>

      {error && <div className="boardBrowserError">{error}</div>}

      <div className="boardBrowserContent">
        <div className="boardBrowserList" ref={listRef}>
          {busy && <Spinner label={isSearching ? "Searching…" : "Loading…"} />}

          {!busy && boardsToShow.length === 0 && (
            <div className="boardBrowserEmpty">
              {isSearching
                ? `No boards matched “${debouncedSearch}”.`
                : "No boards found."}
            </div>
          )}

          {boardsToShow.map((board) => {
            const d = details[board.id];
            const title = d?.name || board.name;
            const author = d?.author || board.author || "Unknown author";
            const icon = d?.icon || board.icon;
            const desc = d?.description || "";
            const loadingRow = !d;
            return (
              <button
                type="button"
                key={board.id}
                className={
                  "boardBrowserCard" +
                  (selectedId === board.id ? " selected" : "")
                }
                onMouseEnter={() => prefetchBoard(board.id)}
                onFocus={() => prefetchBoard(board.id)}
                onClick={() => {
                  prefetchBoard(board.id);
                  setSelectedId(board.id);
                }}
              >
                <div className="boardBrowserCardImageWrap">
                  {icon ? (
                    <img
                      src={resolveIconUrl(icon)}
                      alt=""
                      className="boardBrowserCardImage"
                      loading="lazy"
                    />
                  ) : (
                    <div className="boardBrowserCardPlaceholder">?</div>
                  )}
                </div>
                <div className="boardBrowserCardContent">
                  <div className="boardBrowserCardHeading">
                    <span className="boardBrowserCardTitle">{title}</span>
                    {gameLabel(board.gameId) && (
                      <span className="boardBrowserCardGame">
                        {gameLabel(board.gameId)}
                      </span>
                    )}
                  </div>
                  <div className="boardBrowserCardAuthor">{author}</div>
                  <div className="boardBrowserCardDesc">
                    {loadingRow
                      ? "Loading details…"
                      : desc || "No description."}
                  </div>
                  <div className="boardBrowserCardStats">
                    <span>{renderStars(d?.difficulty)}</span>
                    <span>
                      {d?.recommended_turns != null
                        ? `${d.recommended_turns} turns`
                        : "—"}
                    </span>
                    <span>
                      {d?.custom_events
                        ? "Custom events"
                        : d
                          ? "Stock events"
                          : "—"}
                    </span>
                    <span>
                      {d?.custom_music
                        ? "Custom music"
                        : d
                          ? "Stock music"
                          : "—"}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}

          {(loadingMore ||
            (!isSearching &&
              boardsToShow.some((board) => !details[board.id]))) &&
            !busy && <Spinner label="Loading more…" />}
        </div>

        {selectedBoard && (
          <div
            className="boardBrowserModalOverlay"
            onClick={() => setSelectedId(null)}
          >
            <div
              className="boardBrowserModal"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={selectedBoard.name}
            >
              <BoardDetailsPanel
                board={selectedBoard}
                details={details[selectedBoard.id]}
                lastUpdated={latestDates[selectedBoard.id]}
                onLastUpdated={handleLastUpdated}
                onClose={() => setSelectedId(null)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const BoardDetailsPanel: React.FC<{
  board: BoardListItem;
  details?: BoardDetails;
  lastUpdated?: string;
  onLastUpdated: (id: string, date: string) => void;
  onClose: () => void;
}> = ({ board, details, lastUpdated, onLastUpdated, onClose }) => {
  const cachedVersions = cacheGet(versionsCache, board.id);
  const [versions, setVersions] = React.useState<BoardVersion[]>(
    cachedVersions || [],
  );
  const [loading, setLoading] = React.useState(!cachedVersions);
  const [error, setError] = React.useState<string | null>(null);
  const [importing, setImporting] = React.useState<string | null>(null);
  const [descExpanded, setDescExpanded] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setDescExpanded(false);
    const cached = cacheGet(versionsCache, board.id);
    if (cached) {
      setVersions(cached);
      setLoading(false);
      if (cached[0]?.release_date) {
        onLastUpdated(board.id, cached[0].release_date);
      }
    } else {
      setVersions([]);
      setLoading(true);
    }
    setError(null);

    // Refresh in background even when cached, so counts stay fairly fresh.
    fetchBoardVersions(board.id)
      .then((next) => {
        if (cancelled) return;
        setVersions(next);
        if (next[0]?.release_date) {
          onLastUpdated(board.id, next[0].release_date);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled || err.name === "AbortError") return;
        if (!cacheGet(versionsCache, board.id)) {
          setError("Failed to load versions.");
        }
        setLoading(false);
      });

    // Also ensure details are present if the list never finished enriching.
    void fetchBoardDetails(board.id);

    return () => {
      cancelled = true;
    };
  }, [board.id, onLastUpdated]);

  const handleImport = async (downloadLink: string, boardName: string) => {
    setImporting(downloadLink);
    setError(null);
    try {
      const proxyUrl = `${API_BASE}/cors_bypass?url=${encodeURIComponent(downloadLink)}`;
      const boardJson = await fetchJson<any>(proxyUrl);
      addBoard(boardJson);
      showMessage(`Imported board: ${boardName}`);
      changeView(View.EDITOR);
    } catch {
      setError("Failed to import board.");
    }
    setImporting(null);
  };

  const title = details?.name || board.name;
  const author = details?.author || board.author || "Unknown";
  const icon = resolveIconUrl(details?.icon || board.icon);
  const description = details?.description || "No description.";
  const descLimit = 280;
  const isLong = description.length > descLimit;
  const descShown =
    descExpanded || !isLong
      ? description
      : `${description.slice(0, descLimit).trim()}…`;

  return (
    <div className="boardBrowserDetails">
      <div className="boardBrowserDetailsBanner">
        {icon ? (
          <img
            src={icon}
            alt=""
            className="boardBrowserDetailsBannerImg"
          />
        ) : (
          <div className="boardBrowserDetailsBannerPlaceholder">?</div>
        )}
        <div className="boardBrowserDetailsBannerFade" />
        <div className="boardBrowserDetailsBannerText">
          <h2>{title}</h2>
          <p>by {author}</p>
        </div>
        <button
          type="button"
          className="boardBrowserDetailsClose"
          onClick={onClose}
          title="Close"
        >
          ×
        </button>
      </div>

      <div className="boardBrowserDetailsStats">
        <div>
          <span className="boardBrowserStatLabel">Difficulty</span>
          <span>{renderStars(details?.difficulty)}</span>
        </div>
        <div>
          <span className="boardBrowserStatLabel">Turns</span>
          <span>{details?.recommended_turns ?? "—"}</span>
        </div>
        <div>
          <span className="boardBrowserStatLabel">Events</span>
          <span>
            {details?.custom_events != null
              ? details.custom_events > 0
                ? "Custom"
                : "Stock"
              : "—"}
          </span>
        </div>
        <div>
          <span className="boardBrowserStatLabel">Music</span>
          <span>
            {details?.custom_music != null
              ? details.custom_music > 0
                ? "Custom"
                : "Stock"
              : "—"}
          </span>
        </div>
        <div>
          <span className="boardBrowserStatLabel">Created</span>
          <span>{formatDate(details?.creation_date)}</span>
        </div>
        <div>
          <span className="boardBrowserStatLabel">Updated</span>
          <span>{formatDate(lastUpdated)}</span>
        </div>
      </div>

      <section className="boardBrowserDetailsSection">
        <h3>Description</h3>
        <div className="boardBrowserDetailsDesc">{descShown}</div>
        {isLong && (
          <button
            type="button"
            className="boardBrowserLinkBtn"
            onClick={() => setDescExpanded((v) => !v)}
          >
            {descExpanded ? "Show less" : "Show more"}
          </button>
        )}
      </section>

      <section className="boardBrowserDetailsSection">
        <h3>Versions</h3>
        {loading && <Spinner label="Loading versions…" />}
        {error && <div className="boardBrowserErrorCard">{error}</div>}
        {!loading && !error && versions.length === 0 && (
          <div className="boardBrowserEmpty">No versions available.</div>
        )}
        {!loading && versions.length > 0 && (
          <ul className="boardBrowserVersionList">
            {versions.map((version) => (
              <li
                key={`${version.file_id}-${version.file_version}-${version.release_date}`}
                className="boardBrowserVersionItem"
              >
                <div className="boardBrowserVersionInfo">
                  <span className="boardBrowserVersionTag">
                    v{version.file_version}
                  </span>
                  <span className="boardBrowserVersionDate">
                    {formatDate(version.release_date)}
                  </span>
                  <span className="boardBrowserVersionDownloads">
                    {version.download_count ?? 0} downloads
                  </span>
                </div>
                <div className="boardBrowserVersionActions">
                  <button
                    type="button"
                    className="boardBrowserSecondaryBtn"
                    onClick={() => window.open(version.download_link, "_blank")}
                  >
                    Download
                  </button>
                  <button
                    type="button"
                    className="boardBrowserImportBtn"
                    disabled={importing === version.download_link}
                    onClick={() => handleImport(version.download_link, title)}
                  >
                    {importing === version.download_link
                      ? "Importing…"
                      : "Import"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

export default BoardBrowserPage;
