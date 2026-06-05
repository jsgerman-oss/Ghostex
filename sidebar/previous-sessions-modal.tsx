import { IconStar, IconX } from "@tabler/icons-react";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  filterPreviousSessions,
  filterPreviousSessionsModalItems,
  groupPreviousSessionsByDay,
  removePreviousSessionByHistoryId,
} from "./previous-session-search";
import { SessionHistoryCard } from "./session-history-card";
import { useSidebarStore } from "./sidebar-store";
import {
  applyTextEditingKey,
  isEditableKeyboardTarget,
  isTextEditingKey,
} from "./text-input-keyboard";
import { TOOLTIP_DELAY_MS } from "./tooltip-delay";
import { TooltipProvider } from "./app-tooltip";
import { SidebarSessionSearchField } from "./sidebar-session-search-overlay";
import type { WebviewApi } from "./webview-api";
import type { ExtensionToSidebarMessage, SidebarPreviousSessionItem } from "../shared/session-grid-contract";

const PREVIOUS_SESSIONS_INITIAL_LOAD_TIMEOUT_MS = 2_000;
const PREVIOUS_SESSIONS_QUERY_DEBOUNCE_MS = 200;

export type PreviousSessionsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onInitialLoadReady?: () => void;
  vscode: WebviewApi;
};

export function PreviousSessionsModal({
  isOpen,
  onClose,
  onInitialLoadReady,
  vscode,
}: PreviousSessionsModalProps) {
  const previousSessions = useSidebarStore((state) => state.previousSessions);
  const showDebugSessionNumbers = useSidebarStore((state) => state.hud.debuggingMode);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [remotePreviousSessions, setRemotePreviousSessions] = useState<SidebarPreviousSessionItem[] | undefined>(undefined);
  const [hasInitialLoadResolved, setHasInitialLoadResolved] = useState(false);
  const [hasInitialLoadTimedOut, setHasInitialLoadTimedOut] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const hasRequestedInitialLoadRef = useRef(false);
  const latestRequestIdRef = useRef<string | undefined>(undefined);
  const pendingSelectionRef = useRef<{ end: number; start: number } | undefined>(undefined);
  const modalPreviousSessions = useMemo(
    () => filterPreviousSessionsModalItems(remotePreviousSessions ?? previousSessions),
    [previousSessions, remotePreviousSessions],
  );
  const filteredSessions = useMemo(
    () => filterPreviousSessions(modalPreviousSessions, searchQuery, { favoritesOnly }),
    [favoritesOnly, modalPreviousSessions, searchQuery],
  );
  const groupedSessions = useMemo(
    () => groupPreviousSessionsByDay(filteredSessions),
    [filteredSessions],
  );
  const canShowModal = isOpen && (hasInitialLoadResolved || hasInitialLoadTimedOut);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      const searchInput = searchInputRef.current;
      if (
        !searchInput ||
        event.target === searchInput ||
        isEditableKeyboardTarget(event.target) ||
        !isTextEditingKey(event)
      ) {
        return;
      }

      const nextSearchState = applyTextEditingKey(
        {
          selectionEnd: searchInput.selectionEnd,
          selectionStart: searchInput.selectionStart,
          value: searchInput.value,
        },
        event.key,
        event,
      );
      if (!nextSearchState) {
        return;
      }

      event.preventDefault();
      pendingSelectionRef.current = {
        end: nextSearchState.selectionEnd,
        start: nextSearchState.selectionStart,
      };
      searchInput.focus();
      setSearchQuery(nextSearchState.value);
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      setFavoritesOnly(false);
      setSearchQuery("");
      setRemotePreviousSessions(undefined);
      setHasInitialLoadResolved(false);
      setHasInitialLoadTimedOut(false);
      hasRequestedInitialLoadRef.current = false;
      latestRequestIdRef.current = undefined;
      pendingSelectionRef.current = undefined;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || hasInitialLoadResolved) {
      return;
    }

    /*
    CDXC:PreviousSessions 2026-06-02-20:39:
    Opening Previous Sessions must not flash the empty, short modal while gxserver history is still loading. Keep the modal hidden until the first result proves sessions exist or do not exist, with a two-second max cap so the UI cannot appear stuck behind an unreachable query.
    */
    const timeoutId = window.setTimeout(() => {
      setHasInitialLoadTimedOut(true);
      onInitialLoadReady?.();
    }, PREVIOUS_SESSIONS_INITIAL_LOAD_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [hasInitialLoadResolved, isOpen, onInitialLoadReady]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleMessage = (event: MessageEvent<ExtensionToSidebarMessage>) => {
      if (event.data.type !== "previousSessionsResult") {
        return;
      }
      if (event.data.requestId !== latestRequestIdRef.current) {
        return;
      }
      setRemotePreviousSessions(event.data.previousSessions);
      setHasInitialLoadResolved(true);
      onInitialLoadReady?.();
    };
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [isOpen, onInitialLoadReady]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const requestDelay = hasRequestedInitialLoadRef.current
      ? PREVIOUS_SESSIONS_QUERY_DEBOUNCE_MS
      : 0;
    const timeoutId = window.setTimeout(() => {
      const requestId = `previous-sessions-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      hasRequestedInitialLoadRef.current = true;
      latestRequestIdRef.current = requestId;
      /*
      CDXC:GxserverPresentationSearch 2026-06-01-15:08:
      Previous Sessions no longer depends on a startup-hydrated history array. Request recent/history metadata from gxserver on open and debounce typed search at 200ms so the modal remains bounded by current query results.
      */
      vscode.postMessage({
        favoritesOnly,
        limit: 80,
        query: searchQuery.trim() || undefined,
        requestId,
        type: "requestPreviousSessions",
      });
    }, requestDelay);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [favoritesOnly, isOpen, searchQuery, vscode]);

  useEffect(() => {
    if (!canShowModal) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const input = searchInputRef.current;
      if (!input) {
        return;
      }

      input.focus();
      const selectionIndex = input.value.length;
      input.setSelectionRange(selectionIndex, selectionIndex);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [canShowModal]);

  useEffect(() => {
    if (!canShowModal) {
      pendingSelectionRef.current = undefined;
      return;
    }

    const pendingSelection = pendingSelectionRef.current;
    if (!pendingSelection) {
      return;
    }

    const input = searchInputRef.current;
    if (!input) {
      return;
    }

    pendingSelectionRef.current = undefined;
    input.focus();
    input.setSelectionRange(pendingSelection.start, pendingSelection.end);
  }, [canShowModal, searchQuery]);

  if (!canShowModal) {
    return null;
  }

  return createPortal(
    <TooltipProvider delayDuration={TOOLTIP_DELAY_MS}>
      <div className="confirm-modal-root scroll-mask-y" role="presentation">
        <button className="confirm-modal-backdrop" onClick={onClose} type="button" />
        <div
          aria-labelledby="previous-sessions-modal-title"
          aria-modal="true"
          className="confirm-modal previous-sessions-modal scroll-mask-y"
          role="dialog"
        >
          <button
            aria-label="Close previous sessions"
            className="confirm-modal-close-button"
            onClick={onClose}
            type="button"
          >
            <IconX aria-hidden="true" className="toolbar-tabler-icon" stroke={1.8} />
          </button>
          <div className="confirm-modal-header confirm-modal-header-with-close">
            <div className="confirm-modal-title" id="previous-sessions-modal-title">
              Previous Sessions
            </div>
          </div>
          <div className="previous-sessions-toolbar">
            <SidebarSessionSearchField
              ariaLabel="Search previous sessions"
              clearLabel="Clear previous sessions search"
              inputClassName="previous-sessions-search-input"
              inputRef={searchInputRef}
              placeholder="Search sessions..."
              query={searchQuery}
              setQuery={setSearchQuery}
              toolbarClassName="previous-sessions-search-control"
            />
            <button
              aria-label={
                favoritesOnly
                  ? "Show all previous sessions"
                  : "Show favorite previous sessions only"
              }
              className="previous-sessions-favorites-toggle"
              data-selected={String(favoritesOnly)}
              onClick={() => {
                setFavoritesOnly((previous) => !previous);
              }}
              type="button"
            >
              <IconStar
                aria-hidden="true"
                className="toolbar-tabler-icon"
                fill={favoritesOnly ? "currentColor" : "none"}
                stroke={1.8}
              />
            </button>
          </div>
          <div className="previous-sessions-modal-body scroll-mask-y">
            {groupedSessions.length > 0 ? (
              groupedSessions.map((group) => (
                <section className="previous-sessions-day-group" key={group.dayLabel}>
                  <div className="previous-sessions-day-label">{group.dayLabel}</div>
                  <div className="group-sessions">
                    {group.sessions.map((session) => (
                      <SessionHistoryCard
                        key={session.historyId}
                        onDelete={() => {
                          setRemotePreviousSessions((current) =>
                            removePreviousSessionByHistoryId(current ?? modalPreviousSessions, session.historyId),
                          );
                          vscode.postMessage({
                            historyId: session.historyId,
                            type: "deletePreviousSession",
                          });
                        }}
                        onRestore={() => {
                          vscode.postMessage({
                            historyId: session.historyId,
                            type: "restorePreviousSession",
                          });
                          onClose();
                        }}
                        session={session}
                        showDebugSessionNumbers={showDebugSessionNumbers}
                      />
                    ))}
                  </div>
                </section>
              ))
            ) : (
              <div className="group-empty-state previous-sessions-empty-state">
                {searchQuery.trim()
                  ? favoritesOnly
                    ? "No favorite previous sessions match that search."
                    : "No previous sessions match that search."
                  : favoritesOnly
                    ? "No favorite previous sessions yet."
                    : "No previous sessions yet."}
              </div>
            )}
          </div>
          <div className="previous-sessions-footer">
            <button
              className="previous-sessions-find-button"
              onClick={() => {
                const normalizedQuery = searchQuery.trim();
                if (showDebugSessionNumbers) {
                  console.debug("[ghostex-previous-sessions] promptFindPreviousSession.click", {
                    hasQuery: Boolean(normalizedQuery),
                    queryLength: normalizedQuery.length,
                  });
                }
                /**
                 * CDXC:PreviousSessions 2026-05-07-16:02
                 * The footer button is explicitly a prompt launcher. Always
                 * send the command: an empty sidebar search opens the dedicated
                 * Find Previous Session prompt, while non-empty text is used as
                 * that prompt's initial query.
                 */
                vscode.postMessage({
                  query: normalizedQuery || undefined,
                  type: "promptFindPreviousSession",
                });
                onClose();
              }}
              type="button"
            >
              Prompt to Search
            </button>
            <button
              className="previous-sessions-find-button"
              onClick={() => {
                /**
                 * CDXC:PreviousSessions 2026-05-29-12:36:
                 * Search by Text is the lightweight zehn path: start a new
                 * terminal and run `gx f` directly. Keep it separate from
                 * Prompt to Search, which creates an agent helper and stages a
                 * natural-language recovery prompt.
                 */
                vscode.postMessage({
                  type: "searchPreviousSessionsByText",
                });
                onClose();
              }}
              type="button"
            >
              Search by Text
            </button>
          </div>
        </div>
      </div>
    </TooltipProvider>,
    document.body,
  );
}
