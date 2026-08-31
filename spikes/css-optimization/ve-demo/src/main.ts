import { pageStrip, resBadge } from "./pageStrip.css";

const el = document.createElement("div");
el.className = `${pageStrip} is-action`;
el.textContent = "DigiWorld — page strip (vanilla-extract port)";
document.body.appendChild(el);

const b = document.createElement("span");
b.className = resBadge;
b.textContent = "resource";
document.body.appendChild(b);
