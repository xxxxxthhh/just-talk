import PublicGate from "./components/PublicGate";
import DesktopApp from "./DesktopApp";
import MobileApp from "./mobile/MobileApp";
import { isMobileUI } from "./platform";
import { PUBLIC_MODE } from "./publicMode";

export default function App() {
  const app = isMobileUI() ? <MobileApp /> : <DesktopApp />;
  return PUBLIC_MODE ? <PublicGate>{app}</PublicGate> : app;
}
