import type { SidebarToExtensionMessage } from "./session-grid-contract";

export type AppToastLevel = "info" | "success" | "warning" | "error";

export type AppToastAction = {
  label: string;
  sidebarMessage: SidebarToExtensionMessage;
};

export type AppToastRequest = {
  action?: AppToastAction;
  description?: string;
  durationMs?: number;
  /**
   * CDXC:AppToasts 2026-06-11-21:04:
   * App toasts are a product-level intent, not a renderer contract. Keep the
   * request serializable so macOS can render native NSPanel toasts while
   * Electron renders the same request through shadcn/Sonner without sharing UI
   * implementation details.
   */
  level: AppToastLevel;
  persistent?: boolean;
  title: string;
  toastId?: string;
  type: "toast";
};

export type AppToastOptions = Omit<AppToastRequest, "description" | "level" | "title" | "type">;

export function createAppToastRequest(
  level: AppToastLevel,
  title: string,
  description?: string,
  options: AppToastOptions = {},
): AppToastRequest {
  return {
    ...options,
    ...(description ? { description } : {}),
    level,
    title,
    type: "toast",
  };
}
