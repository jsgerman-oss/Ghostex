import { IconChecklist } from "@tabler/icons-react";
import { createRoot } from "react-dom/client";

function TasksPlaceholderApp() {
  const params = new URLSearchParams(window.location.search);
  const projectName = params.get("projectName")?.trim() || "Project";

  return (
    <main className="tasks-placeholder-shell">
      {/*
        CDXC:ModeSwitcher 2026-05-15-12:38:
        The tasks-backed Project mode is a placeholder React page until the actual project workflow is specified.
        Keep the page intentionally sparse and project-scoped so the titlebar mode switcher has a real in-workarea destination without implying unfinished task behavior.

        CDXC:ProjectMode 2026-05-15-15:35:
        The placeholder should be centered and user-facing as Project, with coming-soon copy that promises automations, todos, docs, and related project workspace features.
      */}
      <section className="tasks-placeholder-panel" aria-labelledby="tasks-placeholder-title">
        <div className="tasks-placeholder-icon" aria-hidden="true">
          <IconChecklist size={28} stroke={1.8} />
        </div>
        <div>
          <p className="tasks-placeholder-kicker">{projectName}</p>
          <h1 id="tasks-placeholder-title">Project</h1>
          <p className="tasks-placeholder-copy">
            Coming soon: automations, todos, docs, and more for this project.
          </p>
        </div>
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
      linear-gradient(180deg, rgba(39, 39, 42, 0.44), rgba(16, 17, 18, 0) 44%),
      #101112;
  }

  .tasks-placeholder-shell {
    align-items: center;
    display: flex;
    justify-content: center;
    min-height: 100vh;
    padding: 32px;
  }

  .tasks-placeholder-panel {
    align-items: center;
    display: flex;
    gap: 18px;
    max-width: 560px;
  }

  .tasks-placeholder-icon {
    align-items: center;
    background: #1f2937;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    color: #a7f3d0;
    display: inline-flex;
    flex: 0 0 auto;
    height: 56px;
    justify-content: center;
    width: 56px;
  }

  .tasks-placeholder-kicker {
    color: rgba(244, 244, 245, 0.62);
    font-size: 13px;
    font-weight: 650;
    letter-spacing: 0;
    margin: 0 0 6px;
  }

  h1 {
    font-size: 34px;
    letter-spacing: 0;
    line-height: 1.05;
    margin: 0;
  }

  .tasks-placeholder-copy {
    color: rgba(244, 244, 245, 0.7);
    font-size: 15px;
    line-height: 1.5;
    margin: 10px 0 0;
  }
`;
document.head.append(styleElement);

createRoot(document.getElementById("root")!).render(<TasksPlaceholderApp />);
