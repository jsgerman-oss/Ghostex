import {
  IconChevronDown,
  IconChevronRight,
  IconEdit,
  IconFile,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getDefaultEditorCommandForSettings } from "../shared/zmux-settings";
import { cn } from "@/lib/utils";
import { AGENT_LOGO_COLORS, AGENT_LOGOS } from "./agent-logos";
import { useSidebarStore } from "./sidebar-store";
import type { WebviewApi } from "./webview-api";
import type { SidebarAgentIcon } from "../shared/sidebar-agents";

type AgentsHubTab = "mds" | "skills" | "hooks" | "configs";

type AgentProfile = {
  agentIcon: SidebarAgentIcon;
  filePath: string;
  label: string;
  profilePath: string;
  targetPath?: string;
};

type AgentsHubFile = {
  content: string;
  id: string;
  language: string;
  name: string;
  path: string;
};

type AgentsHubGroup = {
  description: string;
  files: AgentsHubFile[];
  id: string;
  name: string;
  path: string;
  profiles: AgentProfile[];
};

type MonacoAmdRequire = {
  (deps: string[], callback: () => void): void;
  config?: (config: Record<string, unknown>) => void;
};

declare global {
  interface Window {
    MonacoEnvironment?: unknown;
    monaco?: {
      editor: {
        create: (
          element: HTMLElement,
          options: Record<string, unknown>,
        ) => {
          dispose: () => void;
          getModel: () => unknown;
          getValue: () => string;
          layout: () => void;
          onDidChangeModelContent: (listener: () => void) => { dispose: () => void };
          setValue: (value: string) => void;
        };
        setModelLanguage: (model: unknown, language: string) => void;
      };
    };
  }
}

const mainClaude: AgentProfile = {
  agentIcon: "claude",
  filePath: "/Users/madda/.claude/CLAUDE.md",
  label: "Claude Code main",
  profilePath: "/Users/madda/.claude",
  targetPath: "/Users/madda/.agents/main.md",
};

const personalClaude: AgentProfile = {
  agentIcon: "claude",
  filePath: "/Users/madda/.claude-profiles/personal/CLAUDE.md",
  label: "Claude Code personal",
  profilePath: "/Users/madda/.claude-profiles/personal",
  targetPath: "/Users/madda/.agents/main.md",
};

const mainCodex: AgentProfile = {
  agentIcon: "codex",
  filePath: "/Users/madda/.codex/AGENTS.md",
  label: "Codex main",
  profilePath: "/Users/madda/.codex",
  targetPath: "/Users/madda/.agents/main.md",
};

const personalCodex: AgentProfile = {
  agentIcon: "codex",
  filePath: "/Users/madda/.codex-profiles/personal/AGENTS.md",
  label: "Codex personal",
  profilePath: "/Users/madda/.codex-profiles/personal",
  targetPath: "/Users/madda/.agents/main.md",
};

const workCodex: AgentProfile = {
  agentIcon: "codex",
  filePath: "/Users/madda/.codex-profiles/work/AGENTS.md",
  label: "Codex work",
  profilePath: "/Users/madda/.codex-profiles/work",
  targetPath: "/Users/madda/.agents/main.md",
};

const openCode: AgentProfile = {
  agentIcon: "opencode",
  filePath: "/Users/madda/.config/opencode/opencode.json",
  label: "OpenCode main",
  profilePath: "/Users/madda/.config/opencode",
};

const piAgent: AgentProfile = {
  agentIcon: "pi",
  filePath: "/Users/madda/.pi/agent/settings.json",
  label: "Pi agent",
  profilePath: "/Users/madda/.pi/agent",
};

const linkedProfiles = [mainClaude, personalClaude, mainCodex, personalCodex, workCodex];

const tabLabels: Record<AgentsHubTab, string> = {
  configs: "Configs & MCPs",
  hooks: "Hooks",
  mds: "MDs",
  skills: "Skills",
};

const groupsByTab: Record<AgentsHubTab, AgentsHubGroup[]> = {
  mds: [
    {
      description: "Shared instructions used by linked Claude and Codex profiles.",
      files: [
        {
          content:
            "# Main Agent Instructions\n\nThis shared markdown file is linked into Claude and Codex profiles.\n\nThe filesystem bridge will load the real contents here next.",
          id: "md-main-file",
          language: "markdown",
          name: "main.md",
          path: "/Users/madda/.agents/main.md",
        },
      ],
      id: "md-main",
      name: "main.md",
      path: "/Users/madda/.agents/main.md",
      profiles: linkedProfiles,
    },
  ],
  skills: [
    {
      description: "Shared skill folder linked into agent profile skill directories.",
      files: [
        {
          content:
            "# madda-sync-skills\n\nSelected skill files will be loaded here and edited in Monaco.",
          id: "skill-sync-md",
          language: "markdown",
          name: "SKILL.md",
          path: "/Users/madda/agents/skills/madda-sync-skills/SKILL.md",
        },
        {
          content: "#!/usr/bin/env bash\nset -euo pipefail\n\n# Sync script loads here.",
          id: "skill-sync-script",
          language: "shell",
          name: "scripts/sync_skills.sh",
          path: "/Users/madda/agents/skills/madda-sync-skills/scripts/sync_skills.sh",
        },
        {
          content: "name: madda-sync-skills\ninstall: linked\n",
          id: "skill-sync-agent",
          language: "yaml",
          name: "agents/openai.yaml",
          path: "/Users/madda/agents/skills/madda-sync-skills/agents/openai.yaml",
        },
      ],
      id: "skill-sync",
      name: "madda-sync-skills",
      path: "/Users/madda/agents/skills/madda-sync-skills",
      profiles: linkedProfiles,
    },
  ],
  hooks: [
    {
      description: "Shell, TypeScript, and config files linked into agent hook folders.",
      files: [
        {
          content: "# Shared hooks\n\nHook documentation opens here.",
          id: "hook-readme",
          language: "markdown",
          name: "README.md",
          path: "/Users/madda/agents/hooks/README.md",
        },
        {
          content: "export function notify(message: string) {\n  return message;\n}\n",
          id: "hook-notification",
          language: "typescript",
          name: "notification.ts",
          path: "/Users/madda/agents/hooks/notification.ts",
        },
      ],
      id: "hooks-shared",
      name: "shared hooks",
      path: "/Users/madda/agents/hooks",
      profiles: [...linkedProfiles, piAgent],
    },
  ],
  configs: [
    {
      description: "Claude uses global and profile JSON settings.",
      files: [
        {
          content: "{\n  \"mcpServers\": {}\n}\n",
          id: "config-claude-json",
          language: "json",
          name: "~/.claude.json",
          path: "/Users/madda/.claude.json",
        },
        {
          content: "{\n  \"permissions\": {},\n  \"hooks\": {}\n}\n",
          id: "config-claude-settings",
          language: "json",
          name: "~/.claude/settings.json",
          path: "/Users/madda/.claude/settings.json",
        },
      ],
      id: "config-claude",
      name: "Claude configs",
      path: "/Users/madda/.claude",
      profiles: [mainClaude, personalClaude],
    },
    {
      description: "Codex profile configuration is TOML per profile.",
      files: [
        {
          content: "model = \"gpt-5.1-codex-max\"\n\n[mcp_servers]\n",
          id: "config-codex-main",
          language: "toml",
          name: "~/.codex/config.toml",
          path: "/Users/madda/.codex/config.toml",
        },
        {
          content: "profile = \"personal\"\n\n[mcp_servers]\n",
          id: "config-codex-personal",
          language: "toml",
          name: "~/.codex-profiles/personal/config.toml",
          path: "/Users/madda/.codex-profiles/personal/config.toml",
        },
      ],
      id: "config-codex",
      name: "Codex configs",
      path: "/Users/madda/.codex",
      profiles: [mainCodex, personalCodex, workCodex],
    },
    {
      description: "OpenCode config files live under ~/.config/opencode.",
      files: [
        {
          content: "{\n  \"$schema\": \"https://opencode.ai/config.json\",\n  \"mcp\": {}\n}\n",
          id: "config-opencode-json",
          language: "json",
          name: "opencode.json",
          path: "/Users/madda/.config/opencode/opencode.json",
        },
      ],
      id: "config-opencode",
      name: "OpenCode configs",
      path: "/Users/madda/.config/opencode",
      profiles: [openCode],
    },
    {
      description: "Pi agent settings and extension hooks live under ~/.pi/agent.",
      files: [
        {
          content: "{\n  \"extensions\": []\n}\n",
          id: "config-pi-settings",
          language: "json",
          name: "settings.json",
          path: "/Users/madda/.pi/agent/settings.json",
        },
      ],
      id: "config-pi",
      name: "Pi configs",
      path: "/Users/madda/.pi/agent",
      profiles: [piAgent],
    },
  ],
};

export function AgentsHubModal({
  initialTab,
  isOpen,
  onClose,
  vscode,
}: {
  initialTab?: AgentsHubTab;
  isOpen: boolean;
  onClose: () => void;
  vscode: WebviewApi;
}) {
  const settings = useSidebarStore((state) => state.hud.settings);
  const editorCommand = settings ? getDefaultEditorCommandForSettings(settings) : "code";

  return (
    <TooltipProvider>
      <Dialog open={isOpen} onOpenChange={(open) => (!open ? onClose() : undefined)}>
        <DialogContent className="agents-hub-dialog zmux-settings-shadcn" showCloseButton={false}>
          <button
            aria-label="Close Agents Hub"
            className="agents-hub-close"
            onClick={onClose}
            type="button"
          >
            <IconX aria-hidden="true" />
          </button>
          <DialogHeader className="agents-hub-header">
            <DialogTitle>Agents Hub</DialogTitle>
          </DialogHeader>
          <AgentsHubSurface editorCommand={editorCommand} initialTab={initialTab} vscode={vscode} />
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

function AgentsHubSurface({
  editorCommand,
  initialTab = "mds",
  vscode,
}: {
  editorCommand: string;
  initialTab?: AgentsHubTab;
  vscode: WebviewApi;
}) {
  const [activeTab, setActiveTab] = useState<AgentsHubTab>(initialTab);
  const [query, setQuery] = useState("");
  const [selectedFileIds, setSelectedFileIds] = useState<Record<AgentsHubTab, string>>({
    configs: firstFileId("configs"),
    hooks: firstFileId("hooks"),
    mds: firstFileId("mds"),
    skills: firstFileId("skills"),
  });
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(["skill-sync", "hooks-shared", "config-claude", "config-codex"]),
  );

  const activeFile = findFile(activeTab, selectedFileIds[activeTab]);

  return (
    <Tabs
      className="agents-hub-tabs"
      onValueChange={(value) => setActiveTab(value as AgentsHubTab)}
      value={activeTab}
    >
      <TabsList className="agents-hub-tabs-list">
        {(Object.keys(tabLabels) as AgentsHubTab[]).map((tab) => (
          <TabsTrigger key={tab} value={tab}>
            {tabLabels[tab]}
          </TabsTrigger>
        ))}
      </TabsList>
      {(Object.keys(tabLabels) as AgentsHubTab[]).map((tab) => (
        <TabsContent className="agents-hub-tab-content" key={tab} value={tab}>
          <section className="agents-hub-layout">
            <aside className="agents-hub-list-pane">
              <div className="agents-hub-search">
                <IconSearch data-icon="inline-start" />
                <Input
                  aria-label={`Search ${tabLabels[tab]}`}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={`Search ${tabLabels[tab]}`}
                  value={query}
                />
              </div>
              <ScrollArea className="agents-hub-scroll">
                <GroupList
                  activeFileId={selectedFileIds[tab]}
                  activeTab={tab}
                  expandedIds={expandedIds}
                  onSelectFile={(fileId) => {
                    setActiveTab(tab);
                    setSelectedFileIds((current) => ({ ...current, [tab]: fileId }));
                  }}
                  onToggleExpanded={(groupId) => {
                    setExpandedIds((current) => {
                      const next = new Set(current);
                      if (next.has(groupId)) {
                        next.delete(groupId);
                      } else {
                        next.add(groupId);
                      }
                      return next;
                    });
                  }}
                  query={query}
                  vscode={vscode}
                />
              </ScrollArea>
            </aside>
            <EditorPane editorCommand={editorCommand} file={activeFile} vscode={vscode} />
          </section>
        </TabsContent>
      ))}
    </Tabs>
  );
}

function GroupList({
  activeFileId,
  activeTab,
  expandedIds,
  onSelectFile,
  onToggleExpanded,
  query,
  vscode,
}: {
  activeFileId: string;
  activeTab: AgentsHubTab;
  expandedIds: Set<string>;
  onSelectFile: (fileId: string) => void;
  onToggleExpanded: (groupId: string) => void;
  query: string;
  vscode: WebviewApi;
}) {
  const groups = useFilteredGroups(activeTab, query);
  const expandable = activeTab !== "mds";

  if (groups.length === 0) {
    return (
      <div className="agents-hub-empty">
        <IconSearch data-icon="inline-start" />
        <span>No matching files.</span>
      </div>
    );
  }

  return (
    <div className="agents-hub-group-list">
      {groups.map((group) => {
        const isExpanded = expandedIds.has(group.id);
        const isActiveGroup = group.files.some((file) => file.id === activeFileId);
        const primaryFile = group.files[0]!;

        return (
          <section className={cn("agents-hub-group", isActiveGroup && "is-active")} key={group.id}>
            <button
              className="agents-hub-group-main"
              onClick={() => {
                if (expandable) {
                  onToggleExpanded(group.id);
                }
                onSelectFile(primaryFile.id);
              }}
              type="button"
            >
              <span className="agents-hub-group-title-row">
                {expandable ? (
                  isExpanded ? (
                    <IconChevronDown data-icon="inline-start" />
                  ) : (
                    <IconChevronRight data-icon="inline-start" />
                  )
                ) : (
                  <IconFile data-icon="inline-start" />
                )}
                <span className="agents-hub-group-title">{group.name}</span>
                <span className="agents-hub-count">
                  {group.files.length} {group.files.length === 1 ? "file" : "files"}
                </span>
              </span>
              <span className="agents-hub-path">{group.path}</span>
              <span className="agents-hub-description">{group.description}</span>
            </button>
            <ProfileRow profiles={group.profiles} vscode={vscode} />
            {expandable && isExpanded ? (
              <div className="agents-hub-file-list">
                {group.files.map((file) => (
                  <button
                    className={cn("agents-hub-file-row", file.id === activeFileId && "is-active")}
                    key={file.id}
                    onClick={() => onSelectFile(file.id)}
                    type="button"
                  >
                    <IconFile data-icon="inline-start" />
                    <span>{file.name}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function ProfileRow({ profiles, vscode }: { profiles: AgentProfile[]; vscode: WebviewApi }) {
  return (
    <div className="agents-hub-profile-row" aria-label="Profiles using this item">
      {profiles.map((profile) => {
        const profileBadge = getAgentProfileBadge(profile.profilePath);

        return (
          <Tooltip key={`${profile.agentIcon}-${profile.profilePath}`}>
            <TooltipTrigger asChild>
              <button
                aria-label={`Open ${profile.label} profile in Finder`}
                className="agents-hub-agent-icon"
                onClick={(event) => {
                  event.stopPropagation();
                  vscode.postMessage({
                    path: profile.profilePath,
                    type: "openAgentsHubPathInFinder",
                  });
                }}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className="agents-hub-agent-logo"
                  data-agent-icon={profile.agentIcon}
                  style={{
                    backgroundColor: AGENT_LOGO_COLORS[profile.agentIcon],
                    maskImage: `url("${AGENT_LOGOS[profile.agentIcon]}")`,
                    WebkitMaskImage: `url("${AGENT_LOGOS[profile.agentIcon]}")`,
                  }}
                />
                {profileBadge ? (
                  <span className="agents-hub-agent-badge">{profileBadge}</span>
                ) : null}
              </button>
            </TooltipTrigger>
            <TooltipContent align="start">
              {`${profile.label}\n${profile.filePath}${
                profile.targetPath ? ` -> ${profile.targetPath}` : ""
              }\nClick to open ${profile.profilePath} in Finder`}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

function getAgentProfileBadge(profilePath: string): string | undefined {
  /**
   * CDXC:AgentsHub 2026-05-13-08:16
   * Main agent profiles should show only the agent logo. Non-main profile chips
   * derive their corner badge from the first alphanumeric character of the
   * profile folder name, so `personal` maps to P and `work` maps to W without
   * hard-coded per-agent badge labels.
   */
  if (!profilePath.includes("-profiles/")) {
    return undefined;
  }

  const profileFolder = profilePath.split("/").filter(Boolean).at(-1)?.toLowerCase();
  return profileFolder?.match(/[a-z0-9]/i)?.[0]?.toUpperCase();
}

function EditorPane({
  editorCommand,
  file,
  vscode,
}: {
  editorCommand: string;
  file: AgentsHubFile;
  vscode: WebviewApi;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<ReturnType<NonNullable<typeof window.monaco>["editor"]["create"]> | null>(
    null,
  );
  const latestFileRef = useRef(file);
  const [fallbackValue, setFallbackValue] = useState(file.content);
  const [monacoAvailable, setMonacoAvailable] = useState(true);

  useEffect(() => {
    latestFileRef.current = file;
    setFallbackValue(file.content);
  }, [file]);

  useEffect(() => {
    let disposed = false;
    let contentDisposable: { dispose: () => void } | null = null;

    loadMonaco()
      .then(() => {
        if (disposed || !containerRef.current || !window.monaco || editorRef.current) {
          return;
        }

        const initialFile = latestFileRef.current;
        const editor = window.monaco.editor.create(containerRef.current, {
          automaticLayout: true,
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          language: initialFile.language,
          minimap: { enabled: false },
          padding: { bottom: 16, top: 16 },
          scrollBeyondLastLine: false,
          theme: "vs-dark",
          value: initialFile.content,
        });
        contentDisposable = editor.onDidChangeModelContent(() => {
          setFallbackValue(editor.getValue());
        });
        editorRef.current = editor;
      })
      .catch(() => {
        if (!disposed) {
          setMonacoAvailable(false);
        }
      });

    return () => {
      disposed = true;
      contentDisposable?.dispose();
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = window.monaco;
    if (!editor || !monaco) {
      return;
    }
    if (editor.getValue() !== file.content) {
      editor.setValue(file.content);
    }
    const model = editor.getModel();
    if (model) {
      // Keep Monaco's language mode aligned with the selected file extension.
      monaco.editor.setModelLanguage(model, file.language);
    }
    editor.layout();
  }, [file.content, file.id, file.language]);

  return (
    <div className="agents-hub-editor-frame">
      <div className="agents-hub-editor-toolbar">
        <div className="agents-hub-editor-file">
          <span className="agents-hub-editor-name">{file.name}</span>
          <span className="agents-hub-path">{file.path}</span>
        </div>
        <div className="agents-hub-editor-actions">
          <span className="agents-hub-language">{file.language}</span>
          <Button
            onClick={() =>
              vscode.postMessage({
                filePath: file.path,
                type: "openAgentsHubFileInDefaultEditor",
              })
            }
            size="sm"
            type="button"
            variant="outline"
          >
            <IconEdit data-icon="inline-start" />
            {editorCommand}
          </Button>
        </div>
      </div>
      <Separator />
      <div className="agents-hub-editor-body">
        {monacoAvailable ? (
          <div className="agents-hub-monaco" ref={containerRef} />
        ) : (
          <Textarea
            aria-label={`${file.name} contents`}
            className="agents-hub-editor-fallback"
            onChange={(event) => setFallbackValue(event.target.value)}
            spellCheck={false}
            value={fallbackValue}
          />
        )}
      </div>
    </div>
  );
}

function useFilteredGroups(tab: AgentsHubTab, query: string): AgentsHubGroup[] {
  return useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return groupsByTab[tab];
    }
    return groupsByTab[tab].filter((group) => {
      const groupText = `${group.name} ${group.path} ${group.description}`.toLowerCase();
      const fileText = group.files
        .map((file) => `${file.name} ${file.path}`)
        .join(" ")
        .toLowerCase();
      return groupText.includes(normalizedQuery) || fileText.includes(normalizedQuery);
    });
  }, [query, tab]);
}

function findFile(tab: AgentsHubTab, fileId: string): AgentsHubFile {
  for (const group of groupsByTab[tab]) {
    const file = group.files.find((candidate) => candidate.id === fileId);
    if (file) {
      return file;
    }
  }
  return groupsByTab[tab][0]!.files[0]!;
}

function firstFileId(tab: AgentsHubTab): string {
  return groupsByTab[tab][0]!.files[0]!.id;
}

function getMonacoRequire(): MonacoAmdRequire | undefined {
  return (window as unknown as { require?: MonacoAmdRequire }).require;
}

function loadMonaco(): Promise<void> {
  if (window.monaco) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const configureLoader = (amdRequire: MonacoAmdRequire) => {
      window.MonacoEnvironment = {
        getWorkerUrl: () => "./monaco/vs/base/worker/workerMain.js",
      };
      amdRequire.config?.({ paths: { vs: "./monaco/vs" } });
      amdRequire(["vs/editor/editor.main"], resolve);
    };

    const existingRequire = getMonacoRequire();
    if (existingRequire) {
      configureLoader(existingRequire);
      return;
    }

    const script = document.createElement("script");
    script.src = "./monaco/vs/loader.js";
    script.onload = () => {
      const loadedRequire = getMonacoRequire();
      if (loadedRequire) {
        configureLoader(loadedRequire);
      } else {
        reject(new Error("Monaco loader did not expose require"));
      }
    };
    script.onerror = () => reject(new Error("Unable to load Monaco"));
    document.body.appendChild(script);
  });
}
