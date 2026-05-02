import { homedir } from "node:os";
import { join } from "node:path";

export const AGENTDECK_HOME = join(homedir(), ".agentdeck");
export const AGENTDECK_PROVIDERS = join(AGENTDECK_HOME, "providers");
export const AGENTDECK_UPLOADS = join(AGENTDECK_HOME, "uploads");
export const AGENTDECK_DATA = join(AGENTDECK_HOME, "data");

export const MIN_NODE_MAJOR = 22;
export const DEFAULT_PORT = 8787;

export function detectSuggestedWorkspace() {
  const icloud = join(
    homedir(),
    "Library",
    "Mobile Documents",
    "com~apple~CloudDocs",
    "AgentDeck"
  );
  if (process.platform === "darwin") return icloud;
  return join(AGENTDECK_HOME, "workspace");
}
