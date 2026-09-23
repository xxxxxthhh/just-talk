import DesktopApp from "./DesktopApp";
import MobileApp from "./mobile/MobileApp";
import { isMobileUI } from "./platform";

export default function App() {
  return isMobileUI() ? <MobileApp /> : <DesktopApp />;
}
