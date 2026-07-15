"use client";

import { useRef, useState } from "react";

import AgentDrawer from "@/components/agent/AgentDrawer";
import AgentMascot from "@/components/agent/AgentMascot";
import { trackProductEvent } from "@/lib/analytics/client";
import type { ChatRequest } from "@/lib/rag/types";

type AgentLauncherProps = {
  pageContext?: ChatRequest["pageContext"];
};

export default function AgentLauncher({ pageContext }: AgentLauncherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);

  function handleClose() {
    setIsOpen(false);
    requestAnimationFrame(() => {
      launcherRef.current?.focus();
    });
  }

  function handleOpen() {
    // 游客可直接打开；额度用尽时在发送时再提示登录
    trackProductEvent("agent_opened", {
      page_type: pageContext?.type || "other",
      page_slug: pageContext?.slug,
    });
    setIsOpen(true);
  }

  return (
    <>
      <AgentMascot
        hidden={isOpen}
        launcherRef={launcherRef}
        onOpen={handleOpen}
      />
      <AgentDrawer
        isOpen={isOpen}
        onClose={handleClose}
        pageContext={pageContext}
      />
    </>
  );
}
