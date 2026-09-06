import { createBrowserRouter } from "react-router";
import HomePage from "./pages/HomePage";
import BaseLayout from "./layouts/BaseLayout";
import { AccountPage, AuthPage } from "./pages/UserPage";
import SpacePage from "./pages/SpacesPage/SpacePage";
import CreateSpacePage from "./pages/SpacesPage/CreateSpacePage";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: BaseLayout,
    children: [
      { index: true, Component: HomePage },
      { path: "login", element: <AuthPage key="login" /> },
      { path: "register", element: <AuthPage key="register" register /> },
      { path: "space/create", Component: CreateSpacePage },
      { path: ":account", Component: AccountPage },
      { path: ":account/:spaceSlug", Component: SpacePage },
    ]
  },
]);
