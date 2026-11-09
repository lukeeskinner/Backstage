import { useCallback, useState } from "react";
import { usePolling } from "../hooks/usePolling";
import type { PivotApi } from "./client";
import "./pivot.css";

const COUNT_POLL_MS = 5000;
/** GitHub allows 60 unauthenticated requests an hour per address, so the subject refreshes slowly. */
const COMMIT_POLL_MS = 90000;
const SITES_COMMITS_URL = "https://api.github.com/repos/lukeeskinner/Backstage/commits?sha=agent/sites&path=generated/sites&per_page=1";

/** Latest commit subject on the public agent/sites branch. Sends no credentials. */
export async function fetchLatestSiteCommit(signal: AbortSignal): Promise<string | null> {
  const response = await fetch(SITES_COMMITS_URL, { signal, headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) return null;
  const commits = (await response.json()) as { commit?: { message?: string } }[];
  return commits[0]?.commit?.message?.split("\n")[0] ?? null;
}

export interface ProjectorSitesProps {
  api: PivotApi;
  loadCommit(signal: AbortSignal): Promise<string | null>;
}

/** Projector strip: sites built (organizer token needed for the count) and the agent's latest commit. */
export function ProjectorSites({ api, loadCommit }: ProjectorSitesProps) {
  const [built, setBuilt] = useState<number | null>(null);
  const [subject, setSubject] = useState<string | null>(null);

  const count = useCallback(async (signal: AbortSignal) => {
    const result = await api.getTrends({}, signal);
    if (!signal.aborted && result.ok) setBuilt(result.data.totals.sites_ready);
  }, [api]);
  usePolling(count, COUNT_POLL_MS);

  const commit = useCallback(async (signal: AbortSignal) => {
    try {
      const next = await loadCommit(signal);
      if (!signal.aborted && next) setSubject(next);
    } catch {
      return;
    }
  }, [loadCommit]);
  usePolling(commit, COMMIT_POLL_MS);

  if (built === null && subject === null) return null;
  return (
    <dl className="projector-sites" aria-label="Sites the agent has built">
      {built !== null ? (<><dt>Sites built</dt><dd>{built}</dd></>) : null}
      {subject !== null ? (<><dt>Latest commit</dt><dd className="projector-sites__commit">{subject}</dd></>) : null}
    </dl>
  );
}
