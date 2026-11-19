// BR17.1–BR17.3: the install prompt shows once, only while its flag is on, from the configured visit,
// only when the browser offers installation, and not again within dismissDays of a dismissal.
export type InstallPromptFacts = {
  isFlagOn: boolean;
  isPromptAvailable: boolean;
  visits: number;
  minVisits: number;
  dismissedAt: string | null;
  hasShown: boolean;
  dismissDays: number;
  now: string;
};

export function shouldShowInstallPrompt(f: InstallPromptFacts): boolean {
  if (!f.isFlagOn || !f.isPromptAvailable || f.hasShown || f.visits < f.minVisits) return false;
  if (f.dismissedAt) {
    const elapsedMs = new Date(f.now).getTime() - new Date(f.dismissedAt).getTime();
    if (elapsedMs < f.dismissDays * 24 * 60 * 60 * 1000) return false;
  }
  return true;
}
