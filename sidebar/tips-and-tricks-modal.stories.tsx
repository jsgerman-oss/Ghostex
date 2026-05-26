import type { Meta, StoryObj } from "@storybook/react-vite";
import { TipsAndTricksModal } from "./tips-and-tricks-modal";
import { DEFAULT_ghostex_SETTINGS } from "../shared/ghostex-settings";

const meta = {
  title: "Sidebar/Tips And Tricks Modal",
  parameters: {
    layout: "fullscreen",
  },
  render: () => (
    <div className="first-launch-setup-story-frame">
      <TipsAndTricksModal
        isOpen
        onClose={() => undefined}
        settings={DEFAULT_ghostex_SETTINGS}
        theme="dark-blue"
      />
    </div>
  ),
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Welcome: Story = {};
