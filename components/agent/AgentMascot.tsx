"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { X } from "lucide-react";

const STORAGE_KEY = "agent-mascot-pos";
const INTRO_SEEN_KEY = "agent-mascot-intro-seen-v1";
const WIDTH = 96;
const HEIGHT = 128;
const EDGE = 12;
const DRAG_THRESHOLD = 8;
const EDGE_SNAP_DISTANCE = 28;

const INTRO_TEXT =
  "哈喽，我是小玥～你的美股投资小助手！开港卡、选券商、出入金和入门路径，都可以来问我哦。";

type Pos = { x: number; y: number };

type AgentMascotProps = {
  onOpen: () => void;
  launcherRef?: RefObject<HTMLButtonElement | null>;
  /** Hide without unmounting (avoids flash when drawer opens/closes) */
  hidden?: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function defaultPos(): Pos {
  if (typeof window === "undefined") {
    return { x: EDGE, y: EDGE };
  }
  return {
    x: window.innerWidth - WIDTH - EDGE,
    y: window.innerHeight - HEIGHT - EDGE,
  };
}

function readSavedPos(): Pos | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Pos;
    if (typeof parsed.x === "number" && typeof parsed.y === "number") {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

function clampToViewport(pos: Pos): Pos {
  if (typeof window === "undefined") {
    return pos;
  }
  return {
    x: clamp(pos.x, EDGE, Math.max(EDGE, window.innerWidth - WIDTH - EDGE)),
    y: clamp(pos.y, EDGE, Math.max(EDGE, window.innerHeight - HEIGHT - EDGE)),
  };
}

function settlePos(pos: Pos): Pos {
  const clamped = clampToViewport(pos);
  if (typeof window === "undefined") {
    return clamped;
  }

  const maxX = Math.max(EDGE, window.innerWidth - WIDTH - EDGE);
  let x = clamped.x;
  if (x - EDGE <= EDGE_SNAP_DISTANCE) {
    x = EDGE;
  } else if (maxX - x <= EDGE_SNAP_DISTANCE) {
    x = maxX;
  }

  return { x, y: clamped.y };
}

function markIntroSeen() {
  try {
    localStorage.setItem(INTRO_SEEN_KEY, "1");
  } catch {
    // ignore
  }
}

export default function AgentMascot({
  onOpen,
  launcherRef,
  hidden = false,
}: AgentMascotProps) {
  const [pos, setPos] = useState<Pos | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  const posRef = useRef<Pos | null>(null);
  const dragRef = useRef({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });

  useEffect(() => {
    const next = clampToViewport(readSavedPos() ?? defaultPos());
    posRef.current = next;
    setPos(next);

    let seen = false;
    try {
      seen = localStorage.getItem(INTRO_SEEN_KEY) === "1";
    } catch {
      seen = false;
    }
    if (!seen) {
      const t = window.setTimeout(() => setShowIntro(true), 600);
      return () => window.clearTimeout(t);
    }
  }, []);

  useEffect(() => {
    function onResize() {
      setPos((current) => {
        if (!current) {
          return current;
        }
        const next = clampToViewport(current);
        posRef.current = next;
        return next;
      });
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (hidden && showIntro) {
      setShowIntro(false);
      markIntroSeen();
    }
  }, [hidden, showIntro]);

  const persist = useCallback((next: Pos) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);

  function dismissIntro() {
    setShowIntro(false);
    markIntroSeen();
  }

  function onPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (hidden) {
      return;
    }
    if (event.button !== 0 && event.pointerType === "mouse") {
      return;
    }

    const current = posRef.current;
    if (!current) {
      return;
    }

    dragRef.current = {
      active: true,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
      originX: current.x,
      originY: current.y,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag.active) {
      return;
    }

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      drag.moved = true;
      setIsDragging(true);
      if (showIntro) {
        dismissIntro();
      }
    }

    if (!drag.moved) {
      return;
    }

    event.preventDefault();
    const next = clampToViewport({
      x: drag.originX + dx,
      y: drag.originY + dy,
    });
    posRef.current = next;
    setPos(next);
  }

  function onPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag.active) {
      return;
    }

    drag.active = false;
    setIsDragging(false);

    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }

    if (drag.moved) {
      const settled = settlePos(posRef.current ?? { x: EDGE, y: EDGE });
      posRef.current = settled;
      setPos(settled);
      persist(settled);
      drag.moved = true;
      return;
    }

    if (!hidden) {
      dismissIntro();
      onOpen();
    }
  }

  function onPointerCancel(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    drag.active = false;
    drag.moved = false;
    setIsDragging(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  }

  function onClick(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
  }

  if (!pos) {
    return null;
  }

  const bubbleOnLeft =
    pos.x + WIDTH / 2 > (typeof window !== "undefined" ? window.innerWidth / 2 : 400);

  return (
    <div
      className={[
        "agent-mascot-root",
        isDragging ? "agent-mascot-dragging" : "",
        hidden ? "agent-mascot-hidden" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        width: WIDTH,
        height: HEIGHT,
        zIndex: 9999,
        pointerEvents: "none",
      }}
    >
      {showIntro && !hidden ? (
        <div
          className={[
            "agent-mascot-bubble",
            bubbleOnLeft ? "agent-mascot-bubble-left" : "agent-mascot-bubble-right",
          ].join(" ")}
          role="status"
          aria-live="polite"
        >
          <p className="agent-mascot-bubble-text">{INTRO_TEXT}</p>
          <button
            type="button"
            className="agent-mascot-bubble-close"
            aria-label="关闭提示"
            onClick={(e) => {
              e.stopPropagation();
              dismissIntro();
            }}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
          <span className="agent-mascot-bubble-tail" aria-hidden />
        </div>
      ) : null}

      <button
        ref={launcherRef}
        type="button"
        aria-hidden={hidden || undefined}
        tabIndex={hidden ? -1 : 0}
        aria-label="打开美股扫盲小助手小玥"
        className="agent-mascot"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: WIDTH,
          height: HEIGHT,
          margin: 0,
          padding: 0,
          border: "none",
          background: "transparent",
          cursor: isDragging ? "grabbing" : "grab",
          pointerEvents: hidden ? "none" : "auto",
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
          outline: "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={onClick}
      >
        <span className="agent-mascot-float" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/mascot/assistant.png"
            alt=""
            width={WIDTH}
            height={HEIGHT}
            draggable={false}
            decoding="async"
          />
        </span>
      </button>
    </div>
  );
}
