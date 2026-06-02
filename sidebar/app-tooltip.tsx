import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip";
import { useEffect, useState, type ComponentProps, type ReactElement, type ReactNode } from "react";

export const SIDEBAR_TOOLTIP_DISMISS_EVENT = "ghostex-sidebar-tooltip-dismiss";
export const SIDEBAR_TOOLTIP_SUPPRESSION_CHANGED_EVENT =
  "ghostex-sidebar-tooltip-suppression-changed";

let sidebarTooltipSuppressedForDrag = false;

export function dismissSidebarTooltips() {
  window.dispatchEvent(new Event(SIDEBAR_TOOLTIP_DISMISS_EVENT));
}

export function areSidebarTooltipsSuppressed() {
  return sidebarTooltipSuppressedForDrag;
}

export function setSidebarTooltipsSuppressedForDrag(suppressed: boolean) {
  if (sidebarTooltipSuppressedForDrag === suppressed) {
    return;
  }
  sidebarTooltipSuppressedForDrag = suppressed;
  /*
   * CDXC:SidebarDragTooltips 2026-06-02-20:22:
   * Sidebar project/session drag should not spawn hover tooltips under the pointer. Suppress both Radix and local session title tooltips for the duration of sidebar drag operations, and close any tooltip that was already open when the drag started.
   */
  if (suppressed) {
    dismissSidebarTooltips();
  }
  window.dispatchEvent(new Event(SIDEBAR_TOOLTIP_SUPPRESSION_CHANGED_EVENT));
}

type AppTooltipProps = ComponentProps<typeof Tooltip> & {
  align?: ComponentProps<typeof TooltipContent>["align"];
  children: ReactElement;
  collisionPadding?: ComponentProps<typeof TooltipContent>["collisionPadding"];
  content: ReactNode;
  contentClassName?: string;
  contentStyle?: ComponentProps<typeof TooltipContent>["style"];
  sideOffset?: number;
};

/**
 * CDXC:Tooltips 2026-05-06-18:58
 * User-facing tooltips must render through the shadcn/Radix tooltip instead of
 * native title attributes. Action tooltip copy should describe the action
 * directly and omit project or group names when the surrounding UI already
 * supplies that context.
 */
export function AppTooltip({
  align,
  children,
  collisionPadding,
  content,
  contentClassName,
  contentStyle,
  sideOffset = 8,
  ...tooltipProps
}: AppTooltipProps) {
  const {
    defaultOpen,
    onOpenChange,
    open: controlledOpen,
    ...tooltipRootProps
  } = tooltipProps;
  const isControlled = controlledOpen !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(Boolean(defaultOpen));
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const setOpen = (nextOpen: boolean) => {
    if (nextOpen && areSidebarTooltipsSuppressed()) {
      return;
    }
    if (!isControlled) {
      setUncontrolledOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };

  useEffect(() => {
    const handleDismiss = () => setOpen(false);
    const handleSuppressionChanged = () => {
      if (areSidebarTooltipsSuppressed()) {
        setOpen(false);
      }
    };
    window.addEventListener(SIDEBAR_TOOLTIP_DISMISS_EVENT, handleDismiss);
    window.addEventListener(
      SIDEBAR_TOOLTIP_SUPPRESSION_CHANGED_EVENT,
      handleSuppressionChanged,
    );
    return () => {
      window.removeEventListener(SIDEBAR_TOOLTIP_DISMISS_EVENT, handleDismiss);
      window.removeEventListener(
        SIDEBAR_TOOLTIP_SUPPRESSION_CHANGED_EVENT,
        handleSuppressionChanged,
      );
    };
  });

  if (content === undefined || content === null || content === "") {
    return children;
  }

  /*
   * CDXC:SidebarTooltips 2026-05-25-07:16:
   * Native sidebar tooltips must disappear when the sidebar stops owning pointer
   * hover because WKWebView can miss normal trigger leave events during app
   * switching, external clicks, or fast exits into another native surface. Keep
   * AppTooltip controllable through a shared dismiss event so all Radix tooltip
   * instances close immediately and stay closed until the trigger opens again.
   */
  return (
    <Tooltip {...tooltipRootProps} onOpenChange={setOpen} open={open}>
      <TooltipTrigger render={children} />
      <TooltipContent
        align={align}
        className={contentClassName}
        collisionPadding={collisionPadding}
        sideOffset={sideOffset}
        style={contentStyle}
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
