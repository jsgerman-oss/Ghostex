import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { WorkspaceDock, type WorkspaceBarStateMessage } from "../native/sidebar/native-sidebar";
import "./styles.css";

const state: WorkspaceBarStateMessage = {
  activeProjectId: "project-zmux",
  projects: [
    {
      isActive: true,
      path: "/Users/madda/dev/_active/zmux",
      projectId: "project-zmux",
      sessionCounts: { done: 1, running: 2, working: 1 },
      theme: "dark-blue",
      title: "zmux",
    },
    {
      isActive: false,
      path: "/Users/madda/dev/_active/agent-tiler",
      projectId: "project-agent-tiler",
      sessionCounts: { done: 0, running: 1, working: 0 },
      theme: "dark-green",
      themeColor: "#d17b2f",
      title: "agent-tiler",
    },
  ],
  sidebarMode: "separated",
  type: "workspaceBarState",
};

const meta = {
  decorators: [
    (Story) => (
      <div style={{ height: 520, width: 54 }}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    /**
     * CDXC:StorybookInteractions 2026-05-08-17:46
     * WorkspaceDock is exported from the native sidebar module, whose prop
     * types include action maps and native state shapes that Storybook docgen
     * cannot reliably convert. Keep this story as an explicit render harness
     * instead of component-driven controls so the iframe loads without manager
     * introspection errors.
     */
    controls: { disable: true },
    docs: { disable: true },
    layout: "fullscreen",
  },
  title: "Sidebar/Workspace Dock",
} satisfies Meta<WorkspaceDockStoryArgs>;

export default meta;

type WorkspaceDockStoryArgs = {
  state: WorkspaceBarStateMessage;
};

type Story = StoryObj<WorkspaceDockStoryArgs>;

export const Default: Story = {
  args: {
    state,
  },
  render: ({ state: initialState }) => {
    const [currentState, setCurrentState] = useState(initialState);

    return (
      <WorkspaceDock
        actions={{
          focusProject: (projectId) => {
            setCurrentState((previous) => ({
              ...previous,
              activeProjectId: projectId,
              projects: previous.projects.map((project) => ({
                ...project,
                isActive: project.projectId === projectId,
              })),
            }));
          },
          pickWorkspaceFolder: () => undefined,
          pickWorkspaceIcon: () => undefined,
          removeProject: (projectId) => {
            setCurrentState((previous) => ({
              ...previous,
              projects: previous.projects.filter((project) => project.projectId !== projectId),
            }));
          },
          reorderProjects: (projectIds) => {
            setCurrentState((previous) => ({
              ...previous,
              projects: projectIds
                .map((projectId) =>
                  previous.projects.find((project) => project.projectId === projectId),
                )
                .filter((project): project is (typeof previous.projects)[number] =>
                  Boolean(project),
                ),
            }));
          },
          setProjectTheme: (projectId, theme) => {
            setCurrentState((previous) => ({
              ...previous,
              projects: previous.projects.map((project) =>
                project.projectId === projectId
                  ? { ...project, theme, themeColor: undefined }
                  : project,
              ),
            }));
          },
          setProjectThemeColor: (projectId, themeColor) => {
            setCurrentState((previous) => ({
              ...previous,
              projects: previous.projects.map((project) =>
                project.projectId === projectId ? { ...project, themeColor } : project,
              ),
            }));
          },
        }}
        state={currentState}
      />
    );
  },
};
