import { createBrowserRouter } from "react-router";
import HomePage from "./pages/HomePage";
import BaseLayout from "./layouts/BaseLayout";
import { AccountPage, AuthPage } from "./pages/UserPage";
import SpacePage from "./pages/SpacesPage/SpacePage";
import CreateSpacePage from "./pages/SpacesPage/CreateSpacePage";
import AccessTokensPage from "./pages/UserPage/AccessTokensPage";
import CreateOrganizationPage from "./pages/UserPage/CreateOrganizationPage";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: BaseLayout,
    children: [
      { index: true, Component: HomePage },
      { path: "login", element: <AuthPage key="login" /> },
      { path: "register", element: <AuthPage key="register" register /> },
      { path: "space/create", Component: CreateSpacePage },
      { path: "organization/create", Component: CreateOrganizationPage },
      { path: "settings/access-tokens", Component: AccessTokensPage },
      { path: ":account", Component: AccountPage },
      { path: ":account/:spaceSlug", Component: SpacePage },
      { path: ":account/:spaceSlug/settings", element: <SpacePage settings /> },
    ]
  },
]);
