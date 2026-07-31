import { createRoot } from "react-dom/client";
import { QpcrPlanner } from "@/app/QpcrPlanner";

const container = document.getElementById("qpcr-planner-root");

if (!container) {
  throw new Error("Portable app root was not found.");
}

createRoot(container).render(<QpcrPlanner />);
