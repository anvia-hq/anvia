#!/usr/bin/env node
import "dotenv/config";
import { render } from "ink";
import { App } from "./app.js";

render(<App />, {
  alternateScreen: true,
});
