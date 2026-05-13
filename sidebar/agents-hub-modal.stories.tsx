import type { Meta, StoryObj } from "@storybook/react-vite";
import { AgentsHubModal } from "./agents-hub-modal";
import type { WebviewApi } from "./webview-api";

const mockVscode: WebviewApi = {
  postMessage: () => undefined,
};

function AgentsHubModalStory() {
  return (
    <div
      style={{
        background: "#050505",
        height: "100vh",
        width: "100vw",
      }}
    >
      {/**
       * CDXC:AgentsHub 2026-05-13-08:08
       * The story opens the Skills tab because left-card tree clipping was
       * reported there and needs a stable visual regression target.
       */}
      <AgentsHubModal initialTab="skills" isOpen onClose={() => undefined} vscode={mockVscode} />
    </div>
  );
}

const meta = {
  title: "Sidebar/Agents Hub Modal",
  parameters: {
    layout: "fullscreen",
  },
  render: () => <AgentsHubModalStory />,
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Skills: Story = {};
