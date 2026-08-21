export type TkoActivityFeedState = "loading" | "error" | "empty" | "ready";

export function tko_activityFeedState({
  tko_isLoading,
  tko_isError,
  tko_itemCount,
}: {
  tko_isLoading: boolean;
  tko_isError: boolean;
  tko_itemCount: number;
}): TkoActivityFeedState {
  if (tko_isLoading) return "loading";
  if (tko_isError) return "error";
  return tko_itemCount > 0 ? "ready" : "empty";
}
