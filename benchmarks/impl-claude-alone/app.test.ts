import { runBattery } from "../battery/battery.test.js";
import { createApp } from "./app.js";

runBattery("claude-alone", createApp);
