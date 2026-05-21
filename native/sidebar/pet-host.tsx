import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_PET_ID, normalizePetId, type PetId } from "../../shared/pets";
import { PetAvatar, type PetAnimationState } from "../../sidebar/pet-avatar";
import "../../sidebar/styles.css";

const PET_OVERLAY_STATE_EVENT = "ghostex-pet-overlay-state";
const DRAG_ACTIVATION_DISTANCE_PX = 3;

type PetOverlayActivityState = "attention" | "available" | "working";

type PetOverlayActivity = {
  id: string;
  projectId: string;
  state: PetOverlayActivityState;
  title: string;
};

type PetOverlayStatusItem = {
  count: number;
  status: "attention" | "available" | "working";
};

type PetOverlayState = {
  activities: PetOverlayActivity[];
  activitiesVisible: boolean;
  anchorSide: "left" | "right";
  enabled: boolean;
  selectedPetId: PetId;
  statusItems: PetOverlayStatusItem[];
};

type PetOverlayNativeMessage =
  | { projectId: string; sessionId: string; type: "activateActivity" }
  | { status: PetOverlayStatusItem["status"]; type: "activateStatus" }
  | { screenX: number; screenY: number; type: "dragStart" }
  | { screenX: number; screenY: number; type: "dragMove" }
  | { type: "dragEnd" }
  | { type: "showContextMenu" }
  | { type: "setActivityVisibility"; visible: boolean };

type PetOverlayWebkitWindow = Window & {
  webkit?: {
    messageHandlers?: {
      ghostexPetOverlay?: {
        postMessage: (message: PetOverlayNativeMessage) => void;
      };
    };
  };
};

declare global {
  interface Window {
    __ghostexPetOverlayState?: PetOverlayState;
  }
}

const INITIAL_STATE: PetOverlayState = {
  activities: [],
  activitiesVisible: true,
  anchorSide: "right",
  enabled: false,
  selectedPetId: DEFAULT_PET_ID,
  statusItems: [],
};

function PetHost() {
  const [state, setState] = useState<PetOverlayState>(() => normalizeState(window.__ghostexPetOverlayState));
  const [areActivitiesVisible, setAreActivitiesVisible] = useState(
    () => normalizeState(window.__ghostexPetOverlayState).activitiesVisible,
  );
  const [isHovering, setIsHovering] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragPointerIdRef = useRef<number | undefined>(undefined);
  const dragStartRef = useRef<{ screenX: number; screenY: number } | undefined>(undefined);
  const dragMovedRef = useRef(false);
  const pointerStartedOnPetRef = useRef(false);
  const reducedMotion = useReducedMotion();
  const visibleActivities = useMemo(() => state.activities.slice(0, 3), [state.activities]);

  useEffect(() => {
    document.body.classList.add("pet-host-body");
    const handleState = (event: Event) => {
      const detail = (event as CustomEvent<PetOverlayState>).detail;
      const nextState = normalizeState(detail);
      setState(nextState);
      setAreActivitiesVisible(nextState.activitiesVisible);
    };
    window.addEventListener(PET_OVERLAY_STATE_EVENT, handleState);
    return () => {
      document.body.classList.remove("pet-host-body");
      window.removeEventListener(PET_OVERLAY_STATE_EVENT, handleState);
    };
  }, []);

  useEffect(() => {
    if (!state.enabled) {
      return;
    }
    postPetOverlayMessage({ type: "setActivityVisibility", visible: areActivitiesVisible });
  }, [areActivitiesVisible, state.enabled]);

  if (!state.enabled) {
    return null;
  }

  const animationState = getAnimationState({
    activities: visibleActivities,
    isDragging,
    isHovering,
  });

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragPointerIdRef.current = event.pointerId;
    dragStartRef.current = { screenX: event.screenX, screenY: event.screenY };
    dragMovedRef.current = false;
    pointerStartedOnPetRef.current =
      event.target instanceof Element && event.target.closest(".pet-avatar-button") !== null;
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragPointerIdRef.current !== event.pointerId) {
      return;
    }
    const dragStart = dragStartRef.current;
    if (!dragStart) {
      return;
    }
    const hasCrossedDragThreshold =
      Math.abs(event.screenX - dragStart.screenX) > DRAG_ACTIVATION_DISTANCE_PX ||
      Math.abs(event.screenY - dragStart.screenY) > DRAG_ACTIVATION_DISTANCE_PX;
    if (!dragMovedRef.current && hasCrossedDragThreshold) {
      dragMovedRef.current = true;
      setIsDragging(true);
      postPetOverlayMessage({
        screenX: event.screenX,
        screenY: event.screenY,
        type: "dragStart",
      });
    }
    if (!dragMovedRef.current) {
      return;
    }
    postPetOverlayMessage({
      screenX: event.screenX,
      screenY: event.screenY,
      type: "dragMove",
    });
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragPointerIdRef.current !== event.pointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const shouldToggleActivities =
      event.type === "pointerup" && pointerStartedOnPetRef.current && !dragMovedRef.current;
    const shouldEndNativeDrag = dragMovedRef.current;
    dragPointerIdRef.current = undefined;
    dragStartRef.current = undefined;
    pointerStartedOnPetRef.current = false;
    setIsDragging(false);
    if (shouldEndNativeDrag) {
      postPetOverlayMessage({ type: "dragEnd" });
    }
    if (shouldToggleActivities) {
      setAreActivitiesVisible((visible) => !visible);
    }
  };

  const handleActivityClick = (activity: PetOverlayActivity) => {
    postPetOverlayMessage({
      projectId: activity.projectId,
      sessionId: activity.id,
      type: "activateActivity",
    });
  };

  const handleStatusClick = (status: PetOverlayStatusItem["status"]) => {
    postPetOverlayMessage({ status, type: "activateStatus" });
  };

  const handlePetContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    postPetOverlayMessage({ type: "showContextMenu" });
  };

  const stopActivityPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  /**
   * CDXC:PetOverlay 2026-05-14-10:23:
   * The activity bubble above the pet opens ghostex to the exact shown session
   * when clicked. Do not render the words "working" or "attention" here; the
   * yellow/green dot is the state label.
   * CDXC:PetOverlay 2026-05-21-02:19:
   * Clicking the pet toggles the session cards without sleeping the pet. When
   * cards are hidden, show the same aggregate status choices as the floating
   * native indicator so green/orange/gray clicks keep identical session routing.
   * Expanded cards can also use the gray available state for the two most
   * recent sessions when there are no done or in-progress sessions.
   * Right-clicking the pet is a single native Sleep Pet command. The toggle is
   * resolved on pointer-up because the draggable overlay captures pointer
   * events at the root instead of relying on a nested button click.
   * Collapse/expand state is native-persisted with the pet position and side
   * alignment so restarting the macOS app restores the same overlay shape.
   * CDXC:PetOverlay 2026-05-21-14:47:
   * A zero-movement pet click must toggle cards without entering the native drag
   * lifecycle. Sending dragEnd before the visibility toggle echoes stale native
   * visibility back into React and can make the panel animate through old and new
   * sizes until the next real drag settles it.
   * CDXC:PetOverlay 2026-05-21-14:59:
   * Right-clicking any visible or transparent point in the pet webview should
   * open the native pet menu. Attach context-menu routing to the root overlay
   * instead of the sprite button so cards, status dots, and blank panel space all
   * expose Sleep Pet and Go to Ghostex.
   */
  return (
    <div
      className="pet-host-root"
      data-anchor-side={state.anchorSide}
      onContextMenu={handlePetContextMenu}
      onPointerCancel={finishDrag}
      onPointerDown={handlePointerDown}
      onPointerEnter={() => setIsHovering(true)}
      onPointerLeave={() => setIsHovering(false)}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
    >
      <div className="pet-host-shell" data-dragging={isDragging}>
        {visibleActivities.length > 0 ? (
          <div className="pet-thread-stack" data-visible={String(areActivitiesVisible)}>
            {visibleActivities.map((activity) => (
              <button
                className="pet-thread-bubble"
                data-state={activity.state}
                key={`${activity.projectId}:${activity.id}`}
                onClick={() => handleActivityClick(activity)}
                onPointerDown={stopActivityPointerDown}
                type="button"
              >
                <span className="pet-thread-status" aria-hidden="true" />
                <span className="pet-thread-title">{activity.title}</span>
              </button>
            ))}
          </div>
        ) : null}
        {!areActivitiesVisible && state.statusItems.length > 0 ? (
          <div className="pet-status-indicator" aria-label="Ghostex session status">
            {state.statusItems.map((item) => (
              <button
                aria-label={`${item.count} ${item.status} sessions`}
                className="pet-status-indicator-item"
                data-status={item.status}
                key={item.status}
                onClick={() => handleStatusClick(item.status)}
                onPointerDown={stopActivityPointerDown}
                type="button"
              >
                {item.count}
              </button>
            ))}
          </div>
        ) : null}
        <button
          aria-label={areActivitiesVisible ? "Hide pet sessions" : "Show pet sessions"}
          className="pet-avatar-button"
          type="button"
        >
          <PetAvatar petId={state.selectedPetId} reducedMotion={reducedMotion} state={animationState} />
        </button>
      </div>
    </div>
  );
}

function getAnimationState({
  activities,
  isDragging,
  isHovering,
}: {
  activities: PetOverlayActivity[];
  isDragging: boolean;
  isHovering: boolean;
}): PetAnimationState {
  if (isDragging) {
    return "running";
  }
  if (activities.some((activity) => activity.state === "attention")) {
    return "review";
  }
  if (activities.some((activity) => activity.state === "working")) {
    return "running";
  }
  return isHovering ? "jumping" : "idle";
}

function postPetOverlayMessage(message: PetOverlayNativeMessage): void {
  (window as PetOverlayWebkitWindow).webkit?.messageHandlers?.ghostexPetOverlay?.postMessage(message);
}

function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(() =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = () => setReducedMotion(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return reducedMotion;
}

function normalizeState(value: unknown): PetOverlayState {
  if (!value || typeof value !== "object") {
    return INITIAL_STATE;
  }
  const candidate = value as Partial<PetOverlayState>;
  return {
    activities: Array.isArray(candidate.activities)
      ? candidate.activities.filter(isPetOverlayActivity)
      : [],
    activitiesVisible: candidate.activitiesVisible === false ? false : true,
    anchorSide: candidate.anchorSide === "left" ? "left" : "right",
    enabled: candidate.enabled === true,
    selectedPetId: normalizePetId(candidate.selectedPetId),
    statusItems: Array.isArray(candidate.statusItems)
      ? candidate.statusItems.filter(isPetOverlayStatusItem)
      : [],
  };
}

function isPetOverlayActivity(value: unknown): value is PetOverlayActivity {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<PetOverlayActivity>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.projectId === "string" &&
    typeof candidate.title === "string" &&
    (candidate.state === "attention" ||
      candidate.state === "available" ||
      candidate.state === "working")
  );
}

function isPetOverlayStatusItem(value: unknown): value is PetOverlayStatusItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<PetOverlayStatusItem>;
  return (
    typeof candidate.count === "number" &&
    Number.isFinite(candidate.count) &&
    candidate.count > 0 &&
    (candidate.status === "attention" ||
      candidate.status === "available" ||
      candidate.status === "working")
  );
}

createRoot(document.getElementById("root")!).render(<PetHost />);
