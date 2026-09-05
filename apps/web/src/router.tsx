import { createBrowserRouter } from "react-router";
import HomePage from "./pages/HomePage";
import BaseLayout from "./layouts/BaseLayout";
import UserLayout from "./layouts/UserLayout";
import { AccountPage, LoginPage } from "./pages/UserPage";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: BaseLayout,
    children: [
      { index: true, Component: HomePage },
      {
        path: "user",
        Component: UserLayout,
        children: [
          { path: "login", Component: LoginPage },
          { path: ":account", Component: AccountPage },
        ]
      }
    ]
  },
]);