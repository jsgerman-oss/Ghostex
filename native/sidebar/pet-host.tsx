import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_PET_ID, normalizePetId, type PetId } from "../../shared/pets";
import { PetAvatar, type PetAnimationState } from "../../sidebar/pet-avatar";
import "../../sidebar/styles.css";

const PET_OVERLAY_STATE_EVENT = "zmux-pet-overlay-state";

type PetOverlayActivityState = "attention" | "working";

type PetOverlayActivity = {
  id: string;
  projectId: string;
  state: PetOverlayActivityState;
  title: string;
};

type PetOverlayState = {
  activities: PetOverlayActivity[];
  enabled: boolean;
  selectedPetId: PetId;
};

type PetOverlayNativeMessage =
  | { projectId: string; sessionId: string; type: "activateActivity" }
  | { screenX: number; screenY: number; type: "dragStart" }
  | { screenX: number; screenY: number; type: "dragMove" }
  | { type: "dragEnd" };

type PetOverlayWebkitWindow = Window & {
  webkit?: {
    messageHandlers?: {
      zmuxPetOverlay?: {
        postMessage: (message: PetOverlayNativeMessage) => void;
      };
    };
  };
};

declare global {
  interface Window {
    __zmuxPetOverlayState?: PetOverlayState;
  }
}

const INITIAL_STATE: PetOverlayState = {
  activities: [],
  enabled: false,
  selectedPetId: DEFAULT_PET_ID,
};

function PetHost() {
  const [state, setState] = useState<PetOverlayState>(() => normalizeState(window.__zmuxPetOverlayState));
  const [isHovering, setIsHovering] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragPointerIdRef = useRef<number | undefined>(undefined);
  const reducedMotion = useReducedMotion();
  const visibleActivities = useMemo(() => state.activities.slice(0, 3), [state.activities]);

  useEffect(() => {
    document.body.classList.add("pet-host-body");
    const handleState = (event: Event) => {
      const detail = (event as CustomEvent<PetOverlayState>).detail;
      setState(normalizeState(detail));
    };
    window.addEventListener(PET_OVERLAY_STATE_EVENT, handleState);
    return () => {
      document.body.classList.remove("pet-host-body");
      window.removeEventListener(PET_OVERLAY_STATE_EVENT, handleState);
    };
  }, []);

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
    setIsDragging(true);
    postPetOverlayMessage({
      screenX: event.screenX,
      screenY: event.screenY,
      type: "dragStart",
    });
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragPointerIdRef.current !== event.pointerId) {
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
    dragPointerIdRef.current = undefined;
    setIsDragging(false);
    postPetOverlayMessage({ type: "dragEnd" });
  };

  const handleActivityClick = (activity: PetOverlayActivity) => {
    postPetOverlayMessage({
      projectId: activity.projectId,
      sessionId: activity.id,
      type: "activateActivity",
    });
  };

  const stopActivityPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  /**
   * CDXC:PetOverlay 2026-05-14-10:23:
   * The activity bubble above the pet opens zmux to the exact shown session
   * when clicked. Do not render the words "working" or "attention" here; the
   * yellow/green dot is the state label.
   */
  return (
    <div
      className="pet-host-root"
      onPointerCancel={finishDrag}
      onPointerDown={handlePointerDown}
      onPointerEnter={() => setIsHovering(true)}
      onPointerLeave={() => setIsHovering(false)}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
    >
      <div className="pet-host-shell" data-dragging={isDragging}>
        {visibleActivities.length > 0 ? (
          <div className="pet-thread-stack">
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
        <PetAvatar petId={state.selectedPetId} reducedMotion={reducedMotion} state={animationState} />
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
  (window as PetOverlayWebkitWindow).webkit?.messageHandlers?.zmuxPetOverlay?.postMessage(message);
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
    enabled: candidate.enabled === true,
    selectedPetId: normalizePetId(candidate.selectedPetId),
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
    (candidate.state === "attention" || candidate.state === "working")
  );
}

createRoot(document.getElementById("root")!).render(<PetHost />);
