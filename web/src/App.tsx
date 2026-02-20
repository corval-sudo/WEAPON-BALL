// web/src/App.tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import FighterPage from "./pages/Fighter";
import MatchPage from "./pages/Match";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/fighter/:id" element={<FighterPage />} />
        <Route path="/match/:id" element={<MatchPage />} />
      </Routes>
    </BrowserRouter>
  );
}
