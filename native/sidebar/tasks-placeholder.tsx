import { IconChecklist } from "@tabler/icons-react";
import { createRoot } from "react-dom/client";

function TasksPlaceholderApp() {
  return (
    <main className="tasks-placeholder-shell">
      {/*
        CDXC:ModeSwitcher 2026-05-15-12:38:
        The tasks-backed Project mode is a placeholder React page until the actual project workflow is specified.
        Keep the page intentionally sparse and project-scoped so the titlebar mode switcher has a real in-workarea destination without implying unfinished task behavior.

        CDXC:ProjectMode 2026-05-15-15:35:
        The placeholder should be centered and user-facing as Project, with coming-soon copy that promises automations, todos, docs, and related project workspace features.

        CDXC:ProjectMode 2026-05-15-15:53:
        The empty Project surface should feel like a deliberate product state, not a stretched row. Center the icon, title, and copy vertically with compact planned-feature text so wide panes keep a polished focal point.

        CDXC:ProjectMode 2026-05-15-17:51:
        The coming-soon surface should omit the project name and Project heading, use a neutral gray icon treatment, and widen the subtitle by 100px so the remaining text block feels balanced.

        CDXC:ProjectMode 2026-05-15-18:31:
        The subtitle width should be 200px narrower than the previous wide setting so the coming-soon copy wraps into a more compact centered block.

        CDXC:ProjectMode 2026-05-15-18:37:
        The gap below the icon should be 25px tighter, so reduce the combined icon-bottom and status-top margins without using negative spacing.
      */}
      <section className="tasks-placeholder-panel" aria-labelledby="tasks-placeholder-status">
        <div className="tasks-placeholder-icon" aria-hidden="true">
          <IconChecklist size={34} stroke={1.7} />
        </div>
        <p className="tasks-placeholder-status" id="tasks-placeholder-status">
          Coming soon
        </p>
        <p className="tasks-placeholder-copy">
          Automations, todos, docs, and more will live here for this project.
        </p>
      </section>
    </main>
  );
}

const styleElement = document.createElement("style");
styleElement.textContent = `
  :root {
    color-scheme: dark;
    background: #101112;
    color: #f4f4f5;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif;
  }

  body {
    margin: 0;
    min-height: 100vh;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0) 42%),
      linear-gradient(135deg, #121416 0%, #0e0f10 52%, #111314 100%);
  }

  .tasks-placeholder-shell {
    align-items: center;
    display: flex;
    justify-content: center;
    min-height: 100vh;
    padding: 48px;
  }

  .tasks-placeholder-panel {
    align-items: center;
    color: #f7f7f8;
    display: flex;
    flex-direction: column;
    max-width: 520px;
    text-align: center;
  }

  .tasks-placeholder-icon {
    align-items: center;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02)),
      #202327;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 18px;
    box-shadow:
      0 18px 44px rgba(0, 0, 0, 0.34),
      inset 0 1px 0 rgba(255, 255, 255, 0.08);
    color: rgba(247, 247, 248, 0.76);
    display: inline-flex;
    flex: 0 0 auto;
    height: 76px;
    justify-content: center;
    margin-bottom: 0;
    width: 76px;
  }

  .tasks-placeholder-status {
    color: rgba(247, 247, 248, 0.88);
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 0;
    line-height: 1.25;
    margin: 19px 0 0;
  }

  .tasks-placeholder-copy {
    color: rgba(247, 247, 248, 0.62);
    font-size: 17px;
    line-height: 1.55;
    margin: 8px 0 0;
    max-width: 340px;
  }

  @media (max-width: 560px) {
    .tasks-placeholder-shell {
      padding: 32px 24px;
    }

    .tasks-placeholder-icon {
      border-radius: 16px;
      height: 68px;
      margin-bottom: 20px;
      width: 68px;
    }

    .tasks-placeholder-status {
      font-size: 18px;
      margin-top: 18px;
    }

    .tasks-placeholder-copy {
      font-size: 16px;
    }
  }
`;
document.head.append(styleElement);

createRoot(document.getElementById("root")!).render(<TasksPlaceholderApp />);
