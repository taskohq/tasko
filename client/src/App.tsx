import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import TaskoShell from "./components/TaskoShell";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Work from "./pages/Work";
import Chat from "./pages/Chat";
import CRM from "./pages/CRM";
import Workspace from "./pages/Workspace";

function Router() {
  return (
    <TaskoShell>
      <Switch>
        <Route path={"/"} component={Work} />
        <Route path={"/platform"} component={() => <Workspace mode="overview" />} />
        <Route path={"/inbox"} component={() => <Workspace mode="inbox" />} />
        <Route path={"/docs"} component={() => <Workspace mode="docs" />} />
        <Route path={"/forms"} component={() => <Workspace mode="forms" />} />
        <Route path={"/automations"} component={() => <Workspace mode="automations" />} />
        <Route path={"/calendar"} component={() => <Workspace mode="calendar" />} />
        <Route path={"/work"} component={Work} />
        <Route path={"/chat"} component={Chat} />
        <Route path={"/crm"} component={CRM} />
        <Route path={"/404"} component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </TaskoShell>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
