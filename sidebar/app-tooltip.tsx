import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip";
import { useEffect, useState, type ComponentProps, type ReactElement, type ReactNode } from "react";

export const SIDEBAR_TOOLTIP_DISMISS_EVENT = "ghostex-sidebar-tooltip-dismiss";

export function dismissSidebarTooltips() {
  window.dispatchEvent(new Event(SIDEBAR_TOOLTIP_DISMISS_EVENT));
}

type AppTooltipProps = ComponentProps<typeof Tooltip> & {
  align?: ComponentProps<typeof TooltipContent>["align"];
  children: ReactElement;
  collisionPadding?: ComponentProps<typeof TooltipContent>["collisionPadding"];
  content: ReactNode;
  contentClassName?: string;
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
    if (!isControlled) {
      setUncontrolledOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };

  useEffect(() => {
    const handleDismiss = () => setOpen(false);
    window.addEventListener(SIDEBAR_TOOLTIP_DISMISS_EVENT, handleDismiss);
    return () => window.removeEventListener(SIDEBAR_TOOLTIP_DISMISS_EVENT, handleDismiss);
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
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        align={align}
        className={contentClassName}
        collisionPadding={collisionPadding}
        sideOffset={sideOffset}
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
