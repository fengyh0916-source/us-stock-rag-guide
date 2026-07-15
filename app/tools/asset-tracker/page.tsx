import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import AssetTrackerGate from "@/components/auth/AssetTrackerGate";

export default async function AssetTrackerPage() {
  const user = await getCurrentUser();
  if (user) {
    // Serve the built Vite SPA (public/asset-tracker/index.html)
    redirect("/asset-tracker/index.html");
  }

  // 未登录：展示引导页，引导注册/登录（避免直链绕过首页）
  return <AssetTrackerGate />;
}
