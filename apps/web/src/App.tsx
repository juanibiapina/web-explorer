import { Feed } from "./components/Feed";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { useBackgroundNotification } from "./hooks/useBackgroundNotification";
import { useExplorerStream } from "./hooks/useExplorerStream";

export function App() {
  const { events, viewerCount, stats, connected } = useExplorerStream();
  useBackgroundNotification(events);

  return (
    <div className="min-h-screen">
      <Header connected={connected} viewerCount={viewerCount} />
      <Feed events={events} connected={connected} />
      <Footer stats={stats} />
    </div>
  );
}
