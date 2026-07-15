import AgentLauncher from "@/components/agent/AgentLauncher";
import BeginnerGuides from "@/components/home/BeginnerGuides";
import HomeHero from "@/components/home/HomeHero";
import RelatedTools from "@/components/home/RelatedTools";
import TaskCards from "@/components/home/TaskCards";

export default function HomePage() {
  return (
    <main className="bg-dot-grid min-h-[calc(100vh-3.5rem)] overflow-x-hidden px-4 pb-28 pt-4 text-slate-950 sm:px-6 sm:pb-32 sm:pt-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 py-6 sm:gap-12 sm:py-12 lg:py-16">
        <HomeHero />
        <TaskCards />
        <BeginnerGuides />
        <RelatedTools />
      </div>
      <AgentLauncher pageContext={{ type: "home" }} />
    </main>
  );
}
