import { useCallback, useSyncExternalStore } from "react";
import type { Route } from "../ui/types";

function parse(hash: string): Route {
  if (hash.startsWith("#/demo")) return "demo";
  if (hash.startsWith("#/history")) return "history";
  if (hash.startsWith("#/me")) return "me";
  if (hash.startsWith("#/join")) return "join";
  if (hash.startsWith("#/site")) return "site";
  if (hash.startsWith("#/trends")) return "trends";
  if (hash.startsWith("#/trail")) return "trail";
  if (hash.startsWith("#/status")) {
    return "status";
  }
  if (hash.startsWith("#/projector")) {
    return "projector";
  }
  return "board";
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/** The attendee id in `#/site/<attendee_id>`, or null when the hash carries none. */
export function useSiteId(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => /^#\/site\/([^/?]+)/.exec(window.location.hash)?.[1] ?? null,
    () => null,
  );
}

export function useHashRoute(): [Route, (route: Route) => void] {
  const route = useSyncExternalStore(
    subscribe,
    () => parse(window.location.hash),
    () => "board" as Route,
  );
  const navigate = useCallback((next: Route) => {
    window.location.hash = next === "board" ? "#/" : `#/${next}`;
  }, []);
  return [route, navigate];
}
