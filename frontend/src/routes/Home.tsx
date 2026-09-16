import { useQuery } from "@tanstack/react-query";
import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";

import { useAuth } from "../hooks/useAuth";
import {
  getFriends,
  getDaily,
  claimDaily,
  requestFriendById,
  ApiError,
  type DayReward,
} from "../lib/api";
import { useWsStore } from "../state/wsStore";
import "../styles/extensions-lobby.css";

const DAILY_QUERY_KEY = ["daily"] as const;
const FRIENDS_QUERY_KEY = ["friends"] as const;

function fmtReward(r?: DayReward): string {
  if (!r) return "—";
  const parts: string[] = [];
  if (r.meat) parts.push(`${r.meat} Meat`);
  if (r.bits) parts.push(`${r.bits} Bits`);
  if (r.data) parts.push(`${r.data} Data`);
  if (r.netcore) parts.push(`${r.netcore} NetCore`);
  return parts.join(" + ") || "—";
}

function fmtCountdown(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

export function Home(): JSX.Element {
  const { user } = useAuth();
  const navigate = useNavigate();
  const presenceCount = useWsStore((state) => state.presenceCount);
  const presence = useWsStore((state) => state.presence);

  // daily reward (real /api/daily endpoint)
  const dailyQuery = useQuery({
    queryKey: DAILY_QUERY_KEY,
    queryFn: getDaily,
    staleTime: 30_000,
  });
  const daily = dailyQuery.data;
  const streakDay = daily?.streakDay ?? 0;
  const nextDay = daily?.wouldGrantDay ?? 0;
  const canClaim = daily?.canClaim ?? false;
  const previewDay = canClaim ? nextDay : Math.max(1, streakDay);
  const previewReward = daily?.cycle[previewDay - 1];
  const [claimingDaily, setClaimingDaily] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (canClaim || !daily?.secondsUntilNext) {
      setTick(0);
      return undefined;
    }
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [canClaim, daily?.secondsUntilNext]);
  const secondsLeft = daily?.secondsUntilNext
    ? Math.max(0, daily.secondsUntilNext - tick)
    : 0;

  // friends state (minimal — for "Add friend" from presence)
  const friendsQuery = useQuery({ queryKey: FRIENDS_QUERY_KEY, queryFn: getFriends, staleTime: 15_000 });
  const allFriends = friendsQuery.data?.friends ?? [];
  const [presenceSent, setPresenceSent] = useState<Set<string>>(new Set());

  // daily reward claim + toast
  const toastTimer = useRef<number | null>(null);
  const showToast = useCallback((msg: string) => {
    const el = document.getElementById("lobby-toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    if (toastTimer.current !== null) {
      window.clearTimeout(toastTimer.current);
    }
    toastTimer.current = window.setTimeout(
      () => el.classList.remove("show"),
      2600,
    );
  }, []);

  const handleDailyClaim = async (): Promise<void> => {
    setClaimingDaily(true);
    try {
      const res = await claimDaily();
      await dailyQuery.refetch();
      showToast(`Day ${res.streakDay} claimed: ${fmtReward(res.granted)}`);
    } catch (err) {
      showToast(
        err instanceof ApiError ? err.message : "Couldn't claim today's reward",
      );
    } finally {
      setClaimingDaily(false);
    }
  };

  const handleAddFromPresence = async (userId: string, name: string): Promise<void> => {
    try {
      await requestFriendById(userId);
      setPresenceSent((prev) => new Set(prev).add(userId));
      showToast(`Friend request sent to ${name}`);
      friendsQuery.refetch();
    } catch (err) {
      showToast(
        err instanceof ApiError ? err.message : "Couldn't send friend request",
      );
    }
  };

  // dark theme (lobby-style for home dashboard)
  useEffect(() => {
    document.documentElement.classList.add("is-lobby");
    document.body.classList.add("is-lobby");
    return () => {
      document.documentElement.classList.remove("is-lobby");
      document.body.classList.remove("is-lobby");
    };
  }, []);

  if (user === null) {
    return <></>;
  }

  return (
    <>
      <div className="content-grid">
        {/* daily reward */}
        <div className="daily-mini">
          <div className="dm-ico">
            <span className="rico" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--gold)"
                strokeWidth="2"
                width="22"
                height="22"
              >
                <path d="M12 2l3 6h6l-5 4 2 6-6-4-6 4 2-6-5-4h6z" />
              </svg>
            </span>
          </div>
          <div className="dm-tx">
            <div className="dm-day">
              Daily Reward · Day {previewDay} of 7
            </div>
            <div className="dm-rew">{fmtReward(previewReward)}</div>
            <div className="dm-sub">
              {!daily
                ? "Fetching your streak…"
                : canClaim
                  ? "Claim to keep your streak alive"
                  : streakDay === 0
                    ? "Claim your first daily reward"
                    : `Next reward in ${fmtCountdown(secondsLeft)}`}
            </div>
          </div>
          <div className="dm-pips">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <span
                key={d}
                className={`dm-pip${d <= streakDay ? " claimed" : ""}${canClaim && d === nextDay ? " today" : ""}`}
              >
                {d}
              </span>
            ))}
          </div>
          <button
            className="dm-claim"
            disabled={!canClaim || claimingDaily}
            onClick={handleDailyClaim}
          >
            {claimingDaily
              ? "Claiming…"
              : !daily
                ? "…"
                : canClaim
                  ? "Claim"
                  : "Claimed"}
          </button>
        </div>

        {/* online now */}
        <div className="card">
          <div className="card-hd">
            <span className="k">Online Now</span>
            <span className="v">{presenceCount} in plaza</span>
          </div>
          <div className="list">
            {presence.length === 0 ? (
              <div className="empty-line">
                You're alone here for now — invite a friend or start a
                match.
              </div>
            ) : (
              presence.map((p) => {
                const isFriend = allFriends.some(
                  (f) => f.userId === p.userId,
                );
                const isSelf = p.userId === user?.id;
                const alreadySent =
                  presenceSent.has(p.userId) ||
                  (friendsQuery.data?.outgoing ?? []).some(
                    (r) => r.userId === p.userId,
                  );
                return (
                  <div key={p.userId} className="row">
                    <span className="dot" aria-hidden="true" />
                    <span className="nm">{p.displayName}</span>
                    <span className="tag">Online</span>
                    {!isSelf && !isFriend && (
                      <button
                        className="row-add"
                        disabled={alreadySent}
                        title={alreadySent ? "Request sent" : "Add friend"}
                        aria-label={`Add ${p.displayName} as friend`}
                        onClick={() =>
                          handleAddFromPresence(p.userId, p.displayName)
                        }
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" />
                          <path d="M19 8v6M22 11h-6" />
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* quick actions */}
        <div>
          <div className="card-hd">
            <span className="k">Quick Actions</span>
          </div>
          <div className="qgrid">
            {[
              {
                name: "Adventure",
                href: "/adventure",
                status: "Explore the overworld",
                icon: "M12 2C8 6 4 10 4 14c0 4 3.6 8 8 8s8-4 8-8c0-4-4-8-8-12z M12 18c-2 0-4-2-4-4s2-4 4-4 4 2 4 4-2 4-4 4z",
              },
              {
                name: "Farm",
                href: "/farm",
                status: "Collect resources",
                icon: "M12 22V8 M12 8c0-3 2-6 5-6s5 3 5 6-2 5-5 5 M12 8c0-3-2-6-5-6S2 5 2 8s2 5 5 5",
              },
              {
                name: "Training",
                href: "/training",
                status: "Boost stats",
                icon: "M2 12l5-5 3 3 4-4 5 5 M2 19l5-5 3 3 4-4 5 5",
              },
              {
                name: "Nursery",
                href: "/nursery",
                status: "Hatch eggs",
                icon: "M12 22c4-4 8-8 8-13a8 8 0 1 0-16 0c0 5 4 9 8 13z M12 9a3 3 0 1 1 0-6 3 3 0 0 1 0 6z",
              },
              {
                name: "Roster",
                href: "/roster",
                status: "Manage party",
                icon: "M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4z M4 21a8 8 0 0 1 16 0",
              },
            ].map((qa) => (
              <a key={qa.name} className="qa" href={qa.href}>
                <div className="qa-top">
                  <div className="qa-tile">
                    <svg className="qa-ic" viewBox="0 0 24 24">
                      <path
                        d={qa.icon}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                      />
                    </svg>
                  </div>
                  <span className="qa-badge idle">→</span>
                </div>
                <span className="qa-nm">{qa.name}</span>
                <span className="qa-st">{qa.status}</span>
              </a>
            ))}
          </div>
        </div>
      </div>
      <div
        className="toast"
        id="lobby-toast"
        role="status"
        aria-live="polite"
      />
    </>
  );
}
