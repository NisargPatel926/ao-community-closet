// Netlify Function: renders every page of the site. Static files in /public are served first.
import type { Config } from "@netlify/functions";
import { handle } from "../../src/app.js";

export default (req: Request) => handle(req);

export const config: Config = {
  path: "/*",
  preferStatic: true,
};
