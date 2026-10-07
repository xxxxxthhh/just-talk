import PublicGate from "./components/PublicGate";
import DesktopApp from "./DesktopApp";
import MobileApp from "./mobile/MobileApp";
import { isMobileUI } from "./platform";
import { PUBLIC_MODE } from "./publicMode";
import AdminDashboard from "./components/AdminDashboard";

export default function App() {
  const app = PUBLIC_MODE && window.location.pathname === "/admin"
    ? <AdminDashboard /> : isMobileUI() ? <MobileApp /> : <DesktopApp />;
  return PUBLIC_MODE ? <PublicGate>{app}</PublicGate> : app;
}
