import { createBrowserRouter } from "react-router";
import HomePage from "./pages/HomePage";
import BaseLayout from "./layouts/BaseLayout";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: BaseLayout,
    children: [
      { index: true, Component: HomePage },
    ]
  },
]);