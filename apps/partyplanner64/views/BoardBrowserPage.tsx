import * as React from "react";
import { addBoard } from "../boards";
import { showMessage, changeView } from "../appControl";
import { View } from "../../../packages/lib/types";
import "../css/boardbrowser.scss";

const API_BASE = "https://ppapi.tabs.gay";
const PAGE_SIZE = 20;

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
    { length: Math.min(concurrency, items.length) },
    () => run(),
  );
  await Promise.all(runners);
  return results;
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

  React.useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSearch(searchTerm.trim()),
      280,
    );
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const isSearching = debouncedSearch.length > 0;
  const boardsToShow = isSearching ? searchResults || [] : boards;
  const selectedBoard =
    boardsToShow.find((board) => board.id === selectedId) || null;

  const detailsRef = React.useRef(details);
  detailsRef.current = details;

  const loadEnrichment = React.useCallback(
    async (items: BoardListItem[], signal?: AbortSignal) => {
      const missing = items.filter((item) => !detailsRef.current[item.id]);
      if (!missing.length) return;

      await mapPool(missing, 6, async (item) => {
        if (signal?.aborted) return null;
        try {
          const data = await fetchJson<BoardDetails>(
            `${API_BASE}/project/${item.id}`,
            signal,
          );
          if (!signal?.aborted) {
            setDetails((prev) =>
              prev[item.id] ? prev : { ...prev, [item.id]: data },
            );
          }
        } catch {
          if (!signal?.aborted) {
            setDetails((prev) =>
              prev[item.id] ? prev : { ...prev, [item.id]: { error: true } },
            );
          }
        }
        return null;
      });
    },
    [],
  );

  // Top boards list
  React.useEffect(() => {
    if (isSearching) return;
    const controller = new AbortController();
    const isFirstPage = visibleCount <= PAGE_SIZE && boards.length === 0;
    if (isFirstPage) {
      setLoading(true);
    }
    setError(null);
    fetchJson<any[]>(
      `${API_BASE}/project/top?max=${visibleCount}`,
      controller.signal,
    )
      .then((raw) => {
        const next = raw
          .map(normalizeListItem)
          .filter((item): item is BoardListItem => !!item);
        setBoards(next);
        setLoading(false);
        setLoadingMore(false);
        void loadEnrichment(next, controller.signal);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setError("Failed to load boards.");
        setLoading(false);
        setLoadingMore(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only refetch when page size / search mode changes
  }, [visibleCount, isSearching, loadEnrichment]);

  // Search
  React.useEffect(() => {
    if (!isSearching) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    setError(null);
    fetchJson<any[]>(
      `${API_BASE}/project/search?searchTerm=${encodeURIComponent(debouncedSearch)}`,
      controller.signal,
    )
      .then((raw) => {
        const next = raw
          .map(normalizeListItem)
          .filter((item): item is BoardListItem => !!item);
        setSearchResults(next);
        setSearching(false);
        void loadEnrichment(next, controller.signal);
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
                onClick={() => setSelectedId(board.id)}
              >
                <div className="boardBrowserCardImageWrap">
                  {icon ? (
                    <img
                      src={
                        icon.startsWith("/")
                          ? `${API_BASE}${icon}`
                          : icon
                      }
                      alt=""
                      className="boardBrowserCardImage"
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
                onLastUpdated={(date) =>
                  setLatestDates((prev) => ({
                    ...prev,
                    [selectedBoard.id]: date,
                  }))
                }
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
  onLastUpdated: (date: string) => void;
  onClose: () => void;
}> = ({ board, details, lastUpdated, onLastUpdated, onClose }) => {
  const [versions, setVersions] = React.useState<BoardVersion[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [importing, setImporting] = React.useState<string | null>(null);
  const [descExpanded, setDescExpanded] = React.useState(false);

  React.useEffect(() => {
    setDescExpanded(false);
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    fetchJson<{ versions?: BoardVersion[] }>(
      `${API_BASE}/project/${board.id}/files`,
      controller.signal,
    )
      .then((data) => {
        const next = data.versions || [];
        setVersions(next);
        if (next[0]?.release_date) {
          onLastUpdated(next[0].release_date);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setError("Failed to load versions.");
        setLoading(false);
      });
    return () => controller.abort();
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
  const icon = details?.icon || board.icon;
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
            src={icon.startsWith("/") ? `${API_BASE}${icon}` : icon}
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
