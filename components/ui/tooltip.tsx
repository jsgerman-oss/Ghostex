import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { cn } from "../../lib/utils";

const tooltipSurfaceStyle: React.CSSProperties = {
  background: "var(--ghostex-tooltip-background, rgba(24, 24, 24, 0.98))",
  border: "1px solid var(--ghostex-tooltip-border, rgba(255, 255, 255, 0.12))",
  boxShadow: "var(--ghostex-tooltip-shadow, 0 12px 30px rgba(0, 0, 0, 0.35))",
  color: "var(--ghostex-tooltip-foreground, rgba(255, 255, 255, 0.78))",
  font: "var(--ghostex-tooltip-font, 500 12px/1.35 -apple-system, BlinkMacSystemFont, \"SF Pro Text\", sans-serif)",
};

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

/**
 * CDXC:Tooltips 2026-05-08-16:05
 * App tooltips default below the hovered control. Preserve authored newlines
 * and use Radix's available-width variable so long copy wraps inside the
 * sidebar viewport instead of being clipped by the webview edge.
 *
 * CDXC:Tooltips 2026-05-14-08:45
 * Narrow sidebars need tooltip copy to use up to 90% of the sidebar width.
 * Keep collision padding small and cap the surface with 90vw, because the
 * sidebar webview viewport is the sidebar width. Tooltips do not render arrows;
 * the app uses compact sidebar surfaces where arrows add visual noise and
 * reduce usable text space. Tooltip surfaces are click/hover through because
 * they are passive labels and should not block the dense sidebar controls
 * underneath.
 *
 * CDXC:Tooltips 2026-05-15-19:19:
 * Previous Sessions runs inside the full-window app modal host, and row title
 * tooltips must appear above the modal panel rather than behind its z-indexed
 * root. Keep the shared portaled tooltip layer above app modals so modal-host
 * and sidebar tooltips use the same stacking contract.
 *
 * CDXC:Tooltips 2026-05-26-22:00:
 * Every Radix tooltip surface should match the Resources manager dropdown
 * tooltip treatment: near-black background, dim white default text, subtle
 * white border, and the same elevated shadow. Keep those values as CSS-var
 * fallbacks so native titlebar, sidebar, modal-host, and Storybook contexts can
 * share the surface without requiring their theme bundles to load first.
 *
 * CDXC:Tooltips 2026-05-26-22:29:
 * Tooltip text should also use the Resources manager tooltip font stack and
 * weight so visual matching includes typography, not just surface color,
 * border, and shadow.
 */
function TooltipContent({
  className,
  collisionPadding = 8,
  side = "bottom",
  sideOffset = 0,
  style,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        collisionPadding={collisionPadding}
        data-slot="tooltip-content"
        side={side}
        sideOffset={sideOffset}
        className={cn(
          "pointer-events-none z-50 inline-block w-fit origin-(--radix-tooltip-content-transform-origin) whitespace-pre-line rounded-2xl px-3 py-1.5 text-xs [overflow-wrap:anywhere] has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-4xl data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
        )}
        style={{
          ...tooltipSurfaceStyle,
          maxWidth:
            "min(90vw, var(--radix-tooltip-content-available-width, 90vw))",
          zIndex: "var(--ghostex-tooltip-z-index, 1400)",
          ...style,
        }}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
