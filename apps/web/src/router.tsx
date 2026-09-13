import { createBrowserRouter, Navigate } from "react-router";
import HomePage from "./pages/HomePage";
import BaseLayout from "./layouts/BaseLayout";
import { AccountPage, AuthPage } from "./pages/UserPage";
import SpacePage from "./pages/SpacesPage/SpacePage";
import CreateSpacePage from "./pages/SpacesPage/CreateSpacePage";
import SettingsLayout from "./pages/SettingsPage/SettingsLayout";
import ProfileSettings from "./pages/SettingsPage/ProfileSettings";
import ApplicationsPage from "./pages/SettingsPage/ApplicationsPage";
import RequestState from "./components/RequestState";
import CreateOrganizationPage from "./pages/UserPage/CreateOrganizationPage";
import AppPage from "./pages/AppPages/AppPage";
import AdminPage from "./pages/AdminPage/AdminPage";

export const router = createBrowserRouter([
  { path: '/app/:appType/:spaceId/*', Component: AppPage },
  {
    path: "/",
    Component: BaseLayout,
    children: [
      { index: true, Component: HomePage },
      { path: "login", element: <AuthPage key="login" /> },
      { path: "register", element: <AuthPage key="register" register /> },
      { path: "space/create", Component: CreateSpacePage },
      { path: "organization/create", Component: CreateOrganizationPage },
      { path: "settings", Component: SettingsLayout, children: [
        { index: true, element: <Navigate to="profile" replace /> },
        { path: "profile", Component: ProfileSettings },
        { path: "applications", Component: ApplicationsPage },
        { path: "access-tokens", element: <Navigate to="/settings/applications" replace /> },
        { path: "*", element: <RequestState title="Settings page not found" message="Choose a setting from the sidebar." /> },
      ] },
      { path: "settings/admin", Component: AdminPage },
      { path: ":account", Component: AccountPage },
      { path: ":account/:spaceSlug", Component: SpacePage },
      { path: ":account/:spaceSlug/*", Component: SpacePage },
      { path: ":account/:spaceSlug/settings", element: <SpacePage settings /> },
    ]
  },
]);
