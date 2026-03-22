import { Feed } from "./components/Feed";
import { Header } from "./components/Header";
import { useExplorerStream } from "./hooks/useExplorerStream";

export function App() {
  const { events, viewerCount, connected } = useExplorerStream();

  return (
    <div className="min-h-screen">
      <Header connected={connected} viewerCount={viewerCount} />
      <Feed events={events} />
    </div>
  );
}
